//! Automatic library refresh: registered local folders are watched with the
//! OS's native file-watching (FSEvents on macOS, inotify on Linux), and a
//! debounced incremental rescan runs when something under them changes. The
//! frontend is then poked with a `library-changed` event so new files appear
//! without a manual refresh. Remote (SFTP) folders are not watched — they
//! still refresh on the manual rescan.

use crate::db;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Quiet period after the last event before the rescan fires — agents tend to
/// write files in bursts, and one pass over the burst beats one per file.
const DEBOUNCE: Duration = Duration::from_millis(1200);
/// A steady stream of events must not defer the rescan forever.
const MAX_WAIT: Duration = Duration::from_secs(10);

pub struct FolderWatcher {
    watcher: Mutex<RecommendedWatcher>,
    /// Watched local root path → folder id (shared with the event callback).
    roots: Arc<Mutex<HashMap<PathBuf, i64>>>,
}

/// Whether an event path can affect the library: a supported document, or
/// something with no extension (likely a directory being created/moved).
/// Editor droppings (`*.tmp`) and dotfiles (`.DS_Store`) are ignored so
/// Finder browsing doesn't trigger rescans.
fn relevant(path: &Path) -> bool {
    if path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
    {
        return false;
    }
    crate::is_supported(path) || path.extension().is_none()
}

/// Build the watcher and spawn the debounce worker. Called once at startup;
/// roots are added/removed afterwards via [`FolderWatcher::watch`]/[`unwatch`].
pub fn start(app: AppHandle) -> notify::Result<FolderWatcher> {
    let roots: Arc<Mutex<HashMap<PathBuf, i64>>> = Arc::default();
    let (tx, rx) = channel::<i64>();

    let cb_roots = roots.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, notify::EventKind::Access(_)) {
            return;
        }
        // Map each event path back to the registered root(s) it lives under.
        let map = cb_roots.lock().unwrap();
        let mut hit: HashSet<i64> = HashSet::new();
        for p in event.paths.iter().filter(|p| relevant(p)) {
            for (root, id) in map.iter() {
                if p.starts_with(root) {
                    hit.insert(*id);
                }
            }
        }
        drop(map);
        for id in hit {
            let _ = tx.send(id);
        }
    })?;

    std::thread::spawn(move || debounce_loop(app, rx));
    Ok(FolderWatcher {
        watcher: Mutex::new(watcher),
        roots,
    })
}

impl FolderWatcher {
    /// Start watching a local folder root. Failure is logged, not fatal — the
    /// folder still works through manual rescans.
    pub fn watch(&self, root: &str, folder_id: i64) {
        let path = PathBuf::from(root);
        match self.watcher.lock().unwrap().watch(&path, RecursiveMode::Recursive) {
            Ok(()) => {
                self.roots.lock().unwrap().insert(path, folder_id);
            }
            Err(e) => eprintln!("watch {root}: {e}"),
        }
    }

    pub fn unwatch(&self, root: &str) {
        let path = PathBuf::from(root);
        let _ = self.watcher.lock().unwrap().unwatch(&path);
        self.roots.lock().unwrap().remove(&path);
    }
}

/// Collect folder ids from the event callback and rescan once a folder has
/// been quiet for DEBOUNCE (or has been busy for MAX_WAIT straight).
fn debounce_loop(app: AppHandle, rx: Receiver<i64>) {
    let mut pending: HashSet<i64> = HashSet::new();
    let mut oldest: Option<Instant> = None;
    loop {
        let timeout = if pending.is_empty() {
            Duration::from_secs(3600)
        } else {
            DEBOUNCE
        };
        match rx.recv_timeout(timeout) {
            Ok(id) => {
                pending.insert(id);
                let now = Instant::now();
                let start = *oldest.get_or_insert(now);
                if now.duration_since(start) >= MAX_WAIT {
                    flush(&app, &mut pending);
                    oldest = None;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !pending.is_empty() {
                    flush(&app, &mut pending);
                }
                oldest = None;
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Incrementally rescan every pending folder, then tell the frontend the
/// library may have moved under it.
fn flush(app: &AppHandle, pending: &mut HashSet<i64>) {
    let ids: Vec<i64> = pending.drain().collect();
    let Some(state) = app.try_state::<crate::AppState>() else {
        return;
    };
    let now = crate::now_secs();
    let conn = state.db.lock().unwrap();
    for id in ids {
        // The folder may have been removed since the event fired.
        let Ok(Some(root)) = db::folder_path(&conn, id) else {
            continue;
        };
        if let Err(e) = crate::scan_folder(&conn, id, &root, now) {
            eprintln!("auto-rescan {root}: {e}");
        }
    }
    drop(conn);
    // Even a zero-change scan can have flipped missing flags, so let the
    // frontend refetch cheaply rather than guess from a diff summary.
    let _ = app.emit("library-changed", ());
}
