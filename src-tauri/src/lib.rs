mod db;
mod html;
mod remote;
mod watch;

use db::{FileEntry, Folder, ScanResult, TagCount};
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};
use walkdir::WalkDir;

struct AppState {
    db: Mutex<Connection>,
    remotes: remote::Pool,
    /// None when the platform watcher could not start — auto-refresh degrades
    /// to manual rescans instead of failing the app.
    watcher: Option<watch::FolderWatcher>,
}

type CmdResult<T> = Result<T, String>;

fn epoch(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_secs() -> i64 {
    epoch(SystemTime::now())
}

fn ext_lower(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase())
}

fn is_md(path: &Path) -> bool {
    matches!(ext_lower(path).as_deref(), Some("md") | Some("markdown") | Some("mdown") | Some("mkd"))
}

/// File types the viewer can index and render.
fn is_supported(path: &Path) -> bool {
    matches!(ext_lower(path).as_deref(), Some("html") | Some("htm")) || is_md(path)
}

/// Read a single file from disk, extract its metadata and upsert it into the DB.
fn index_single(
    conn: &Connection,
    path: &Path,
    folder_id: Option<i64>,
    now: i64,
) -> rusqlite::Result<(i64, bool)> {
    let path_str = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);
    let modified = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(epoch)
        .unwrap_or(0);
    let created = meta
        .as_ref()
        .and_then(|m| m.created().ok())
        .map(epoch)
        .unwrap_or(modified);

    let raw = std::fs::read(path).unwrap_or_default();
    index_content(conn, &path_str, &name, &raw, size, modified, created, folder_id, now)
}

/// Extract metadata from in-memory file content and upsert it into the DB —
/// the filesystem-agnostic core shared by local and remote (SFTP) indexing.
#[allow(clippy::too_many_arguments)]
fn index_content(
    conn: &Connection,
    path_str: &str,
    name: &str,
    raw: &[u8],
    size: i64,
    modified: i64,
    created: i64,
    folder_id: Option<i64>,
    now: i64,
) -> rusqlite::Result<(i64, bool)> {
    let text = String::from_utf8_lossy(raw);
    let m = if is_md(Path::new(path_str)) {
        html::extract_md(&text)
    } else {
        html::extract(&text)
    };

    db::upsert_file(
        conn,
        path_str,
        name,
        m.title.as_deref(),
        m.heading.as_deref(),
        &m.body,
        size,
        modified,
        created,
        folder_id,
        now,
    )
}

/// Recursively scan a registered folder, indexing new/changed files and
/// removing entries whose files have disappeared.
fn scan_folder(conn: &Connection, folder_id: i64, root: &str, now: i64) -> rusqlite::Result<ScanResult> {
    let mut res = ScanResult::default();

    // Existing index for this folder: path -> (id, modified, size, missing)
    let stats = db::folder_file_stats(conn, folder_id)?;

    // An unreachable root (unmounted drive, offline share) must not be read as
    // "every file was deleted": flag the entries missing instead, keeping their
    // favorites/tags intact until the root comes back.
    if !Path::new(root).is_dir() {
        for (id, _, _, _, missing) in &stats {
            if !missing {
                db::set_missing(conn, *id, true)?;
            }
        }
        return Ok(res);
    }

    let mut known = std::collections::HashMap::new();
    for (id, path, modified, size, missing) in stats {
        known.insert(path, (id, modified, size, missing));
    }
    let mut seen: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() || !is_supported(entry.path()) {
            continue;
        }
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        seen.insert(path_str.clone());
        res.scanned += 1;

        // Skip re-indexing if size + mtime are unchanged.
        if let Some((id, modified, size, missing)) = known.get(&path_str) {
            if let Ok(m) = std::fs::metadata(path) {
                let cur_mod = m.modified().ok().map(epoch).unwrap_or(0);
                if *modified == cur_mod && *size == m.len() as i64 {
                    // Seen on disk again after an unreachable-root pass.
                    if *missing {
                        db::set_missing(conn, *id, false)?;
                    }
                    continue;
                }
            }
        }

        match index_single(conn, path, Some(folder_id), now) {
            Ok((_, true)) => res.added += 1,
            Ok((_, false)) => res.updated += 1,
            Err(_) => {}
        }
    }

    // The walk succeeded, so anything previously known but not seen this pass
    // has genuinely been deleted.
    for (path, (id, _, _, _)) in &known {
        if !seen.contains(path) {
            db::delete_file(conn, *id)?;
            res.removed += 1;
        }
    }

    Ok(res)
}

/// Remote (SFTP) analog of `scan_folder`: the same skip-unchanged and
/// delete-unseen logic, with reads going through the connection pool. Entries
/// are only deleted after a walk that provably covered the whole tree; an
/// unreachable host or vanished root marks everything missing instead.
fn scan_remote_folder(
    conn: &Connection,
    pool: &remote::Pool,
    folder_id: i64,
    root_url: &str,
    now: i64,
) -> Result<ScanResult, remote::RemoteError> {
    let db_err = |e: rusqlite::Error| remote::RemoteError::Other(e.to_string());
    let (hostkey, root) = remote::split_sftp_url(root_url)
        .ok_or_else(|| remote::RemoteError::Other("Invalid remote path".into()))?;
    let mut res = ScanResult::default();
    let stats = db::folder_file_stats(conn, folder_id).map_err(db_err)?;

    match pool.with_sftp(&hostkey, |sftp| remote::is_remote_dir(sftp, &root)) {
        Ok(true) => {}
        // The tree is gone or the host is down — flag entries missing so
        // tags/favorites survive until it comes back (never delete here).
        Ok(false) | Err(remote::RemoteError::NotFound) | Err(remote::RemoteError::Unreachable(_)) => {
            for (id, _, _, _, missing) in &stats {
                if !missing {
                    db::set_missing(conn, *id, true).map_err(db_err)?;
                }
            }
            return Ok(res);
        }
        // Auth problems etc.: state unknown — touch nothing, let the caller decide.
        Err(e) => return Err(e),
    }

    let mut known = std::collections::HashMap::new();
    for (id, path, modified, size, missing) in stats {
        known.insert(path, (id, modified, size, missing));
    }
    let mut seen: HashSet<String> = HashSet::new();

    let (entries, complete) =
        pool.with_sftp(&hostkey, |sftp| remote::walk(sftp, &root, is_supported))?;
    for entry in entries {
        let path_str = format!("{}{}{}", remote::SFTP_PREFIX, hostkey, entry.path);
        seen.insert(path_str.clone());
        res.scanned += 1;

        // Skip re-indexing if size + mtime are unchanged (stats came with the walk).
        if let Some((id, modified, size, missing)) = known.get(&path_str) {
            if *modified == entry.modified && *size == entry.size {
                if *missing {
                    db::set_missing(conn, *id, false).map_err(db_err)?;
                }
                continue;
            }
        }
        if entry.size > remote::MAX_FILE_BYTES as i64 {
            continue;
        }

        let raw = match pool.with_sftp(&hostkey, |sftp| remote::read_file(sftp, &entry.path)) {
            Ok(b) => b,
            Err(remote::RemoteError::NotFound) => continue, // vanished mid-scan
            Err(e) => return Err(e),
        };
        let name = entry.path.rsplit('/').next().unwrap_or_default().to_string();
        match index_content(
            conn,
            &path_str,
            &name,
            &raw,
            entry.size,
            entry.modified,
            entry.modified, // SFTP has no birth time
            Some(folder_id),
            now,
        ) {
            Ok((_, true)) => res.added += 1,
            Ok((_, false)) => res.updated += 1,
            Err(_) => {}
        }
    }

    // Deletion is only safe when the walk covered everything (no caps hit,
    // no unreadable subdirectories).
    if complete {
        for (path, (id, _, _, _)) in &known {
            if !seen.contains(path) {
                db::delete_file(conn, *id).map_err(db_err)?;
                res.removed += 1;
            }
        }
    }
    Ok(res)
}

// ---- commands --------------------------------------------------------------

#[tauri::command]
fn list_folders(state: State<AppState>) -> CmdResult<Vec<Folder>> {
    let conn = state.db.lock().unwrap();
    db::list_folders(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_folder(state: State<AppState>, path: String) -> CmdResult<ScanResult> {
    if !Path::new(&path).is_dir() {
        return Err("The selected path is not a folder".into());
    }
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    let id = db::add_folder(&conn, &path, now).map_err(|e| e.to_string())?;
    let res = scan_folder(&conn, id, &path, now).map_err(|e| e.to_string())?;
    if let Some(w) = &state.watcher {
        w.watch(&path, id);
    }
    Ok(res)
}

#[tauri::command]
fn remove_folder(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    if let (Some(w), Ok(Some(path))) = (&state.watcher, db::folder_path(&conn, id)) {
        if !path.starts_with(remote::SFTP_PREFIX) {
            w.unwatch(&path);
        }
    }
    db::remove_folder(&conn, id).map_err(|e| e.to_string())
}

/// Register a remote (SSH/SFTP) folder and run its first scan.
#[tauri::command]
fn add_remote_folder(
    state: State<AppState>,
    target: String,
    path: String,
    auth: String,
    key_path: Option<String>,
) -> CmdResult<ScanResult> {
    let target = target.trim().to_string();
    let path = path.trim().trim_end_matches('/').to_string();
    if target.is_empty() || target.contains('/') || target.contains(char::is_whitespace) {
        return Err("Check the connection target (e.g. user@host, host:port, or an ssh config alias)".into());
    }
    if path.is_empty() {
        return Err("The remote root (/) cannot be registered — choose a subdirectory".into());
    }
    if !path.starts_with('/') {
        return Err("The remote path must be an absolute path starting with /".into());
    }
    let url = format!("{}{}{}", remote::SFTP_PREFIX, target, path);

    let conn = state.db.lock().unwrap();
    let now = now_secs();
    db::upsert_remote(&conn, &target, &auth, key_path.as_deref()).map_err(|e| e.to_string())?;
    state.remotes.set_auth(
        &target,
        remote::AuthSpec { auth, key_path },
    );

    // Same guard as the local add_folder, over SFTP.
    match state.remotes.with_sftp(&target, |sftp| remote::is_remote_dir(sftp, &path)) {
        Ok(true) => {}
        Ok(false) | Err(remote::RemoteError::NotFound) => {
            return Err("The selected path is not a folder".into());
        }
        Err(e) => return Err(e.to_command_error()),
    }

    let id = db::add_folder(&conn, &url, now).map_err(|e| e.to_string())?;
    scan_remote_folder(&conn, &state.remotes, id, &url, now).map_err(|e| e.to_command_error())
}

/// Cache a password for this app run only — it is never written to disk;
/// after a restart the user is prompted again (keychain support: future work).
#[tauri::command]
fn set_remote_password(state: State<AppState>, hostkey: String, password: String) -> CmdResult<()> {
    state.remotes.set_password(&hostkey, password);
    Ok(())
}

/// Tab-completion support for the add-remote-folder dialog: subdirectories of
/// `path`'s parent whose name starts with its last segment, as full paths.
#[tauri::command]
fn list_remote_dirs(
    state: State<AppState>,
    target: String,
    path: String,
    auth: String,
    key_path: Option<String>,
) -> CmdResult<Vec<String>> {
    let target = target.trim().to_string();
    if target.is_empty() || target.contains('/') || target.contains(char::is_whitespace) {
        return Err("Invalid connection target".into());
    }
    if !path.starts_with('/') {
        return Err("Not an absolute path".into());
    }
    // Use the dialog's current auth choices for the connection; they are only
    // persisted to the DB when the folder is actually added.
    state.remotes.set_auth(&target, remote::AuthSpec { auth, key_path });

    // "/home/user/pro" → list "/home/user", keep entries starting with "pro".
    let idx = path.rfind('/').unwrap_or(0);
    let dir = if idx == 0 { "/" } else { &path[..idx] };
    let partial = &path[idx + 1..];

    let names = state
        .remotes
        .with_sftp(&target, |sftp| {
            let mut v = Vec::new();
            for (p, stat) in sftp.readdir(Path::new(dir))? {
                if stat.is_dir() {
                    if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                        v.push(name.to_string());
                    }
                }
            }
            Ok(v)
        })
        .map_err(|e| e.to_command_error())?;

    // Hidden dirs only show once the user starts typing a dot themselves.
    let mut out: Vec<String> = names
        .into_iter()
        .filter(|n| n.starts_with(partial) && (partial.starts_with('.') || !n.starts_with('.')))
        .map(|n| if idx == 0 { format!("/{n}") } else { format!("{dir}/{n}") })
        .collect();
    out.sort();
    out.truncate(50);
    Ok(out)
}

#[tauri::command]
fn rescan(state: State<AppState>) -> CmdResult<ScanResult> {
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    let folders = db::list_folders(&conn).map_err(|e| e.to_string())?;
    let mut total = ScanResult::default();
    for f in folders {
        if f.path.starts_with(remote::SFTP_PREFIX) {
            // Remote problems must not abort the whole rescan: a locked host
            // is reported via needs_auth, anything else was already handled
            // non-destructively inside scan_remote_folder.
            match scan_remote_folder(&conn, &state.remotes, f.id, &f.path, now) {
                Ok(r) => {
                    total.scanned += r.scanned;
                    total.added += r.added;
                    total.updated += r.updated;
                    total.removed += r.removed;
                }
                Err(remote::RemoteError::PasswordRequired(hk)) => {
                    if !total.needs_auth.contains(&hk) {
                        total.needs_auth.push(hk);
                    }
                }
                Err(e) => eprintln!("rescan {}: {}", f.path, e.to_command_error()),
            }
            continue;
        }
        let r = scan_folder(&conn, f.id, &f.path, now).map_err(|e| e.to_string())?;
        total.scanned += r.scanned;
        total.added += r.added;
        total.updated += r.updated;
        total.removed += r.removed;
    }

    // Re-validate individually-opened files (no parent folder to scan):
    // re-index ones that changed on disk, mark them missing when their path no
    // longer resolves, and re-index them if they reappear. Their entry is kept
    // so the user can see + forget them.
    for (id, path, modified, size, was_missing) in
        db::standalone_files(&conn).map_err(|e| e.to_string())?
    {
        let p = Path::new(&path);
        match std::fs::metadata(p).ok().filter(|m| m.is_file()) {
            Some(m) => {
                total.scanned += 1;
                let cur_mod = m.modified().ok().map(epoch).unwrap_or(0);
                if was_missing || cur_mod != modified || m.len() as i64 != size {
                    // Also clears the missing flag via the upsert.
                    index_single(&conn, p, None, now).map_err(|e| e.to_string())?;
                    total.updated += 1;
                }
            }
            None => {
                if !was_missing {
                    db::set_missing(&conn, id, true).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(total)
}

#[tauri::command]
fn list_files(
    state: State<AppState>,
    view: String,
    tag: Option<String>,
    dir: Option<String>,
    query: Option<String>,
    sort: Option<String>,
    ascending: Option<bool>,
) -> CmdResult<Vec<FileEntry>> {
    let conn = state.db.lock().unwrap();
    let q = query.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let folder = dir.as_deref().filter(|s| !s.is_empty());
    db::list_files(
        &conn,
        &view,
        tag.as_deref(),
        folder,
        q,
        sort.as_deref(),
        ascending.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct DirCount {
    root_id: i64,
    dir: String,
    count: i64,
}

/// Directory file counts for building the sidebar folder tree.
#[tauri::command]
fn list_dirs(state: State<AppState>) -> CmdResult<Vec<DirCount>> {
    let conn = state.db.lock().unwrap();
    let rows = db::dir_counts(&conn).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(root_id, dir, count)| DirCount { root_id, dir, count })
        .collect())
}

#[tauri::command]
fn get_file(state: State<AppState>, id: i64) -> CmdResult<Option<FileEntry>> {
    let conn = state.db.lock().unwrap();
    db::get_file(&conn, id).map_err(|e| e.to_string())
}

/// Open an arbitrary file path (e.g. from the native picker): index it if it is
/// not already known, mark it as recently opened, and return the entry.
#[tauri::command]
fn open_path(state: State<AppState>, path: String) -> CmdResult<FileEntry> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("File not found".into());
    }
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    // Index unconditionally: for a known entry this refreshes its metadata +
    // FTS row (the file may have been rewritten since) and clears any stale
    // missing flag; for a new one it creates the entry. An existing folder_id
    // survives via COALESCE in the upsert.
    let id = index_single(&conn, p, None, now).map_err(|e| e.to_string())?.0;
    db::record_open(&conn, id, now).map_err(|e| e.to_string())?;
    db::get_file(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Could not load the file's entry".into())
}

#[tauri::command]
fn record_open(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    db::record_open(&conn, id, now_secs()).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_favorite(state: State<AppState>, id: i64, favorite: bool) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    db::set_favorite(&conn, id, favorite).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_tags(state: State<AppState>) -> CmdResult<Vec<TagCount>> {
    let conn = state.db.lock().unwrap();
    db::list_tags(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_file_tags(state: State<AppState>, id: i64, tags: Vec<String>) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    db::set_file_tags(&conn, id, &tags).map_err(|e| e.to_string())
}

/// Forget a single file: remove its entry (and FTS row + tags) from the library
/// index. The original file on disk is never touched — this is for cleaning up
/// the library, e.g. an individually-opened file whose path has since changed.
#[tauri::command]
fn forget_file(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    db::delete_file(&conn, id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Serves remote (SFTP) file bytes to the webview. SFTP ops can block
        // for seconds, and on macOS this callback runs on the main thread, so
        // the actual work always happens on a worker thread.
        .register_asynchronous_uri_scheme_protocol("remote", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri_path = request.uri().path().to_string();
            let origin = request
                .headers()
                .get(tauri::http::header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
            let preflight = request.method() == tauri::http::Method::OPTIONS;
            std::thread::spawn(move || {
                if preflight {
                    return responder.respond(remote::preflight(origin.as_deref()));
                }
                match app.try_state::<AppState>() {
                    Some(state) => responder.respond(remote::serve(
                        &state.remotes,
                        &uri_path,
                        origin.as_deref(),
                    )),
                    None => responder.respond(
                        tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .expect("static response"),
                    ),
                }
            });
        })
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("library.db"))?;
            db::init(&conn)?;
            // Load remote auth specs into the pool so the protocol handler
            // never needs the DB lock (a long scan must not block viewing).
            let remotes = remote::Pool::default();
            for (hostkey, auth, key_path) in db::list_remotes(&conn)? {
                remotes.set_auth(&hostkey, remote::AuthSpec { auth, key_path });
            }
            // Watch registered local folders so new agent output shows up
            // without a manual rescan. Remote folders are polled manually.
            let watcher = match watch::start(app.handle().clone()) {
                Ok(w) => Some(w),
                Err(e) => {
                    eprintln!("file watcher unavailable: {e}");
                    None
                }
            };
            if let Some(w) = &watcher {
                for f in db::list_folders(&conn)? {
                    if !f.path.starts_with(remote::SFTP_PREFIX) {
                        w.watch(&f.path, f.id);
                    }
                }
            }
            app.manage(AppState {
                db: Mutex::new(conn),
                remotes,
                watcher,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_folders,
            add_folder,
            add_remote_folder,
            set_remote_password,
            list_remote_dirs,
            remove_folder,
            rescan,
            list_files,
            list_dirs,
            get_file,
            open_path,
            record_open,
            set_favorite,
            list_tags,
            set_file_tags,
            forget_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
