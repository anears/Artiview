mod db;
mod html;

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
    let text = String::from_utf8_lossy(&raw);
    let m = if is_md(path) {
        html::extract_md(&text)
    } else {
        html::extract(&text)
    };

    db::upsert_file(
        conn,
        &path_str,
        &name,
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

    // Existing index for this folder: path -> (id, modified, size)
    let stats = db::folder_file_stats(conn, folder_id)?;
    let mut known = std::collections::HashMap::new();
    for (id, path, modified, size) in stats {
        known.insert(path, (id, modified, size));
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
        if let Some((_, modified, size)) = known.get(&path_str) {
            if let Ok(m) = std::fs::metadata(path) {
                let cur_mod = m.modified().ok().map(epoch).unwrap_or(0);
                if *modified == cur_mod && *size == m.len() as i64 {
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

    // Anything previously known but not seen this pass has been deleted.
    for (path, (id, _, _)) in &known {
        if !seen.contains(path) {
            db::delete_file(conn, *id)?;
            res.removed += 1;
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
        return Err("선택한 경로가 폴더가 아닙니다".into());
    }
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    let id = db::add_folder(&conn, &path, now).map_err(|e| e.to_string())?;
    scan_folder(&conn, id, &path, now).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_folder(state: State<AppState>, id: i64) -> CmdResult<()> {
    let conn = state.db.lock().unwrap();
    db::remove_folder(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn rescan(state: State<AppState>) -> CmdResult<ScanResult> {
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    let folders = db::list_folders(&conn).map_err(|e| e.to_string())?;
    let mut total = ScanResult::default();
    for f in folders {
        let r = scan_folder(&conn, f.id, &f.path, now).map_err(|e| e.to_string())?;
        total.scanned += r.scanned;
        total.added += r.added;
        total.updated += r.updated;
        total.removed += r.removed;
    }

    // Re-validate individually-opened files (no parent folder to scan): mark
    // them missing when their path no longer resolves, and clear the flag if
    // they reappear. Their entry is kept so the user can see + forget them.
    for (id, path, was_missing) in db::standalone_files(&conn).map_err(|e| e.to_string())? {
        let now_missing = !Path::new(&path).is_file();
        if now_missing != was_missing {
            db::set_missing(&conn, id, now_missing).map_err(|e| e.to_string())?;
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
) -> CmdResult<Vec<FileEntry>> {
    let conn = state.db.lock().unwrap();
    let q = query.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let folder = dir.as_deref().filter(|s| !s.is_empty());
    db::list_files(&conn, &view, tag.as_deref(), folder, q).map_err(|e| e.to_string())
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
        return Err("파일을 찾을 수 없습니다".into());
    }
    let conn = state.db.lock().unwrap();
    let now = now_secs();
    let id = match db::get_file_by_path(&conn, &path).map_err(|e| e.to_string())? {
        // Re-opened via the picker → the file demonstrably exists, so clear any
        // stale missing flag left over from a previous rescan.
        Some(id) => {
            db::set_missing(&conn, id, false).map_err(|e| e.to_string())?;
            id
        }
        None => index_single(&conn, p, None, now).map_err(|e| e.to_string())?.0,
    };
    db::record_open(&conn, id, now).map_err(|e| e.to_string())?;
    db::get_file(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "파일 정보를 불러오지 못했습니다".into())
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
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data dir");
            std::fs::create_dir_all(&dir).ok();
            let conn = Connection::open(dir.join("library.db"))?;
            db::init(&conn)?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_folders,
            add_folder,
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
