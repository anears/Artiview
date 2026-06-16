//! SQLite-backed store for folders, indexed files, recents, favorites and tags,
//! plus an FTS5 full-text index over each file's title/heading/body.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
    pub file_count: i64,
}

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub title: Option<String>,
    pub heading: Option<String>,
    pub size: i64,
    pub modified: i64,
    pub created: i64,
    pub favorite: bool,
    pub last_opened: Option<i64>,
    pub open_count: i64,
    pub folder_id: Option<i64>,
    pub missing: bool,
    pub tags: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct TagCount {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize, Clone, Default)]
pub struct ScanResult {
    pub scanned: i64,
    pub added: i64,
    pub updated: i64,
    pub removed: i64,
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS folders (
            id        INTEGER PRIMARY KEY,
            path      TEXT UNIQUE NOT NULL,
            added_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id          INTEGER PRIMARY KEY,
            path        TEXT UNIQUE NOT NULL,
            name        TEXT NOT NULL,
            title       TEXT,
            heading     TEXT,
            size        INTEGER NOT NULL DEFAULT 0,
            modified    INTEGER NOT NULL DEFAULT 0,
            created     INTEGER NOT NULL DEFAULT 0,
            indexed_at  INTEGER NOT NULL DEFAULT 0,
            folder_id   INTEGER REFERENCES folders(id) ON DELETE SET NULL,
            favorite    INTEGER NOT NULL DEFAULT 0,
            last_opened INTEGER,
            open_count  INTEGER NOT NULL DEFAULT 0,
            missing     INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_files_folder   ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_favorite ON files(favorite);
        CREATE INDEX IF NOT EXISTS idx_files_recent   ON files(last_opened);

        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            title, heading, body, tokenize = 'unicode61'
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE
        );

        CREATE TABLE IF NOT EXISTS file_tags (
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
            PRIMARY KEY (file_id, tag_id)
        );
        "#,
    )
}

// ---- folders ---------------------------------------------------------------

pub fn list_folders(conn: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.path, f.added_at,
                (SELECT COUNT(*) FROM files WHERE folder_id = f.id AND missing = 0)
         FROM folders f ORDER BY f.path",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Folder {
                id: r.get(0)?,
                path: r.get(1)?,
                added_at: r.get(2)?,
                file_count: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn add_folder(conn: &Connection, path: &str, now: i64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO folders(path, added_at) VALUES (?1, ?2)
         ON CONFLICT(path) DO NOTHING",
        params![path, now],
    )?;
    let id: i64 = conn.query_row("SELECT id FROM folders WHERE path = ?1", [path], |r| r.get(0))?;
    Ok(id)
}

pub fn remove_folder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    // Delete only files that belong exclusively to this folder.
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT id FROM files WHERE folder_id = ?1")?;
        let rows = stmt
            .query_map([id], |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for fid in ids {
        delete_file(conn, fid)?;
    }
    conn.execute("DELETE FROM folders WHERE id = ?1", [id])?;
    Ok(())
}

// ---- files -----------------------------------------------------------------

/// Insert or update a single file's metadata + FTS body. Returns (file_id, was_new).
#[allow(clippy::too_many_arguments)]
pub fn upsert_file(
    conn: &Connection,
    path: &str,
    name: &str,
    title: Option<&str>,
    heading: Option<&str>,
    body: &str,
    size: i64,
    modified: i64,
    created: i64,
    folder_id: Option<i64>,
    now: i64,
) -> rusqlite::Result<(i64, bool)> {
    let existing: Option<i64> = conn
        .query_row("SELECT id FROM files WHERE path = ?1", [path], |r| r.get(0))
        .optional()?;

    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE files SET name=?2, title=?3, heading=?4, size=?5, modified=?6,
                    created=?7, indexed_at=?8, missing=0,
                    folder_id=COALESCE(?9, folder_id)
                 WHERE id=?1",
                params![id, name, title, heading, size, modified, created, now, folder_id],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO files(path, name, title, heading, size, modified, created,
                    indexed_at, folder_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![path, name, title, heading, size, modified, created, now, folder_id],
            )?;
            conn.last_insert_rowid()
        }
    };

    // Refresh FTS row (rowid == file id).
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id])?;
    conn.execute(
        "INSERT INTO files_fts(rowid, title, heading, body) VALUES (?1,?2,?3,?4)",
        params![id, title.unwrap_or(""), heading.unwrap_or(""), body],
    )?;

    Ok((id, existing.is_none()))
}

pub fn delete_file(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id])?;
    conn.execute("DELETE FROM files WHERE id = ?1", [id])?;
    Ok(())
}

/// Indexed files for a folder as (id, path, modified, size) — used on rescan to
/// skip unchanged files and detect deletions.
pub fn folder_file_stats(
    conn: &Connection,
    folder_id: i64,
) -> rusqlite::Result<Vec<(i64, String, i64, i64)>> {
    let mut stmt =
        conn.prepare("SELECT id, path, modified, size FROM files WHERE folder_id = ?1")?;
    let rows = stmt
        .query_map([folder_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Generic listing with an optional view filter, tag, folder and search query.
/// `folder_path` filters to files anywhere beneath that directory (recursive).
pub fn list_files(
    conn: &Connection,
    view: &str,
    tag: Option<&str>,
    folder_path: Option<&str>,
    query: Option<&str>,
) -> rusqlite::Result<Vec<FileEntry>> {
    let mut sql = String::from("SELECT DISTINCT f.id FROM files f");
    let mut wheres: Vec<String> = vec!["f.missing = 0".into()];
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(tag) = tag {
        sql.push_str(
            " JOIN file_tags ft ON ft.file_id = f.id JOIN tags t ON t.id = ft.tag_id",
        );
        wheres.push("t.name = ?".into());
        binds.push(Box::new(tag.to_string()));
    }

    if let Some(dir) = folder_path {
        let trimmed = dir.trim_end_matches('/');
        wheres.push("f.path LIKE ? ESCAPE '\\'".into());
        binds.push(Box::new(format!("{}/%", like_escape(trimmed))));
    }

    match view {
        "favorites" => wheres.push("f.favorite = 1".into()),
        "recent" => wheres.push("f.last_opened IS NOT NULL".into()),
        _ => {}
    }

    if let Some(q) = query {
        if let Some(fts) = to_fts_query(q) {
            let like = format!("%{}%", q.replace('%', "").replace('_', ""));
            wheres.push("(f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?) OR f.path LIKE ? OR f.name LIKE ?)".into());
            binds.push(Box::new(fts));
            binds.push(Box::new(like.clone()));
            binds.push(Box::new(like));
        } else {
            let like = format!("%{}%", q.replace('%', "").replace('_', ""));
            wheres.push("(f.path LIKE ? OR f.name LIKE ?)".into());
            binds.push(Box::new(like.clone()));
            binds.push(Box::new(like));
        }
    }

    if !wheres.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&wheres.join(" AND "));
    }

    let order = match view {
        "recent" => " ORDER BY f.last_opened DESC",
        "favorites" => " ORDER BY f.modified DESC",
        _ => " ORDER BY f.modified DESC",
    };
    sql.push_str(order);
    sql.push_str(" LIMIT 2000");

    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let ids: Vec<i64> = {
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(bind_refs.as_slice(), |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    load_entries(conn, &ids, order)
}

pub fn get_file(conn: &Connection, id: i64) -> rusqlite::Result<Option<FileEntry>> {
    Ok(load_entries(conn, &[id], "")?.into_iter().next())
}

pub fn get_file_by_path(conn: &Connection, path: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT id FROM files WHERE path = ?1", [path], |r| r.get(0))
        .optional()
}

/// Load full FileEntry rows for a set of ids, preserving the requested order.
fn load_entries(conn: &Connection, ids: &[i64], order: &str) -> rusqlite::Result<Vec<FileEntry>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, path, name, title, heading, size, modified, created, favorite,
                last_opened, open_count, folder_id, missing
         FROM files WHERE id IN ({placeholders}){}",
        if order.is_empty() {
            String::new()
        } else {
            order.replace("f.", "")
        }
    );
    let id_refs: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut entries = stmt
        .query_map(id_refs.as_slice(), |r| {
            Ok(FileEntry {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                title: r.get(3)?,
                heading: r.get(4)?,
                size: r.get(5)?,
                modified: r.get(6)?,
                created: r.get(7)?,
                favorite: r.get::<_, i64>(8)? != 0,
                last_opened: r.get(9)?,
                open_count: r.get(10)?,
                folder_id: r.get(11)?,
                missing: r.get::<_, i64>(12)? != 0,
                tags: Vec::new(),
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Attach tags in one pass.
    let tag_map = tags_for(conn, ids)?;
    for e in &mut entries {
        if let Some(ts) = tag_map.get(&e.id) {
            e.tags = ts.clone();
        }
    }
    Ok(entries)
}

fn tags_for(conn: &Connection, ids: &[i64]) -> rusqlite::Result<HashMap<i64, Vec<String>>> {
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT ft.file_id, t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
         WHERE ft.file_id IN ({placeholders}) ORDER BY t.name",
    );
    let id_refs: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|i| i as &dyn rusqlite::ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    let rows = stmt.query_map(id_refs.as_slice(), |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (fid, name) = row?;
        map.entry(fid).or_default().push(name);
    }
    Ok(map)
}

// ---- recents / favorites ---------------------------------------------------

pub fn record_open(conn: &Connection, id: i64, now: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET last_opened = ?2, open_count = open_count + 1 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn set_favorite(conn: &Connection, id: i64, fav: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET favorite = ?2 WHERE id = ?1",
        params![id, fav as i64],
    )?;
    Ok(())
}

// ---- tags ------------------------------------------------------------------

pub fn list_tags(conn: &Connection) -> rusqlite::Result<Vec<TagCount>> {
    let mut stmt = conn.prepare(
        "SELECT t.name, COUNT(ft.file_id)
         FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id
         LEFT JOIN files f ON f.id = ft.file_id AND f.missing = 0
         GROUP BY t.id HAVING COUNT(f.id) > 0 ORDER BY t.name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TagCount {
                name: r.get(0)?,
                count: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_file_tags(conn: &Connection, file_id: i64, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM file_tags WHERE file_id = ?1", [file_id])?;
    for raw in tags {
        let name = raw.trim();
        if name.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT INTO tags(name) VALUES (?1) ON CONFLICT(name) DO NOTHING",
            [name],
        )?;
        let tag_id: i64 =
            conn.query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))?;
        conn.execute(
            "INSERT OR IGNORE INTO file_tags(file_id, tag_id) VALUES (?1, ?2)",
            params![file_id, tag_id],
        )?;
    }
    // Prune now-orphaned tags so the sidebar stays clean.
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM file_tags)",
        [],
    )?;
    Ok(())
}

// ---- directories (for the sidebar folder tree) -----------------------------

/// Direct file count per containing directory, as (root_folder_id, dir, count).
/// Only files that belong to a registered folder are included. The frontend
/// expands these into a tree (filling intermediate dirs and recursive counts).
pub fn dir_counts(conn: &Connection) -> rusqlite::Result<Vec<(i64, String, i64)>> {
    let rows: Vec<(i64, String)> = {
        let mut stmt =
            conn.prepare("SELECT folder_id, path FROM files WHERE missing = 0 AND folder_id IS NOT NULL")?;
        let r = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        r
    };
    let mut map: HashMap<(i64, String), i64> = HashMap::new();
    for (root_id, path) in rows {
        if let Some(idx) = path.rfind('/') {
            let dir = path[..idx].to_string();
            *map.entry((root_id, dir)).or_insert(0) += 1;
        }
    }
    Ok(map.into_iter().map(|((id, dir), c)| (id, dir, c)).collect())
}

// ---- helpers ---------------------------------------------------------------

/// Escape LIKE wildcards so a filesystem path is matched literally as a prefix.
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Turn a free-text query into a forgiving FTS5 prefix expression, e.g.
/// `neural net` -> `"neural"* "net"*`. Returns None if nothing usable remains.
fn to_fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}
