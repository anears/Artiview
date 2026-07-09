# Artiview

**A local gallery for the HTML files your coding agents keep generating.**

[한국어 README](README.ko.md)

AI agents (Claude Code, Codex, custom pipelines…) leave a trail of HTML reports,
presentations and Markdown docs all over your disk — and your servers. Artiview
is a macOS desktop app that turns those folders into a browsable library:
live-rendered thumbnails, full-text search, favorites, tags, and **SSH/SFTP
remote folders** that work just like local ones. New files show up
automatically — no manual refresh.

<!-- TODO: add a demo GIF here before launch:
![Artiview demo](docs/demo.gif)
A good demo: an agent writes report.html into a watched folder → the card pops
into the grid → click → instant viewer with ⌘F find.
-->

- **Nothing is ever modified or deleted.** Artiview only indexes; your files are
  untouched. "Remove from library" only deletes the index entry.
- **Local-first.** Everything lives in a local SQLite database. SSH passwords
  are never written to disk.
- **Untrusted HTML is sandboxed.** Viewer and thumbnail iframes run without
  `allow-same-origin`, so a malicious document can't reach the app or its IPC.

## Install

1. Download the latest `Artiview_x.y.z_aarch64.dmg` from
   [Releases](https://github.com/anears/Artiview/releases) (Apple Silicon).
2. Open the dmg and **drag Artiview.app into Applications**.
3. The app is not code-signed yet, so macOS may block the first launch —
   **right-click → Open**, or allow it under System Settings → Privacy & Security.

The UI is in English by default and switches to Korean automatically when your
system language is Korean. Light and dark themes follow the system, and both
language and theme can be overridden in **⚙ Settings** (bottom of the sidebar).

## Getting started

The library starts empty. Add documents in three ways:

| Action | Where | What it does |
|---|---|---|
| **Add folder** | **+** next to "Folders" in the sidebar | Registers a folder; its `.html`/`.htm`/`.md` files are scanned recursively and indexed. |
| **Add remote folder** | **🌐** next to "Folders" | Registers a folder on an SSH server (see [Remote folders](#remote-folders-sshsftp)). |
| **Open a file** | **Open File**, top right | View any single file; it's recorded in the library (Recent) automatically. |

Registered **local folders are watched**: when an agent drops a new file or
rewrites an old one, the library updates by itself within a couple of seconds.
Remote folders re-scan on the **↻ Refresh** button (incremental — only changes
are re-indexed).

## Features

### Library

- **All Files / Recent / Favorites** views, plus a **folder tree** of every
  registered root — click a subfolder to filter to it.
- **Grid or list** layout. Grid thumbnails are the *actual document* rendered
  in a scaled-down sandboxed frame — always current, never a stale screenshot.
- **Sort** by modified/name/size/created/last-opened, ascending or descending.
- Display names resolve as `<title>` → first heading → filename.

### Search

- The library search box matches file names **and the full text of every
  document** (SQLite FTS5 index over title/headings/body).
- Inside the viewer, `⌘/Ctrl+F` finds text in the current document with
  highlights; `Enter`/`Shift+Enter` steps through matches, `Esc` closes.

### Viewer

Click any file to open the built-in viewer: find (`⌘/Ctrl+F`), tags,
favorite ★, remove-from-library 🗑 (never deletes the file), and open-in-browser
for local files. Markdown renders GitHub-style with syntax highlighting, and
relative images/links resolve against the file's own folder — including on
remote servers.

### Remote folders (SSH/SFTP)

Use folders on any SSH-reachable machine as if they were local:

1. Click **🌐** next to "Folders".
2. **Connection** — `user@host`, `user@host:port`, or an alias from
   `~/.ssh/config`.
3. **Remote path** — an absolute path; subdirectories are suggested as you
   type (`Tab` completes like a shell, `↑`/`↓` selects).
4. **Authentication** — *Auto* (ssh-agent → config `IdentityFile` → default
   keys), a *key file* (`.pem`), or a *password*.

Search, thumbnails, the viewer and tags all work identically; relative
images/CSS inside remote HTML are proxied over SFTP. Passwords are held **in
memory only** for the current run — after a restart you'll be prompted again.

### Missing files

Moved/renamed/deleted files are badged, never auto-purged — tags and favorites
survive. An unplugged drive or unreachable server marks its entries missing;
everything recovers on the next scan after it comes back.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl + F` | Find in the open document |
| `Enter` / `Shift+Enter` | Next / previous match |
| `Esc` | Close find bar → modal → viewer |
| `Tab` | Complete remote path (in the remote folder dialog) |

## FAQ

**Does Artiview ever modify or delete my files?**
No. Never. It only reads them; all remove actions affect the index only.

**Where is my data stored?**
Folders, index, recents, favorites and tags live in `library.db` (SQLite) in
the macOS app-data directory. SSH passwords are not stored anywhere.

**Remote folder says "authentication failed".**
Check that `ssh <target>` works in a terminal first. If your key is in
ssh-agent (`ssh-add -l`) or configured via `IdentityFile`, *Auto* will find it.
Key files need `600` permissions.

**The scan skipped some files.**
Remote scans are capped for safety: depth 16, 20k entries, 50MB per file.

## Known limitations

- macOS Apple Silicon builds only (for now — the code is portable Tauri/Rust).
- SSH host keys are not yet checked against `known_hosts`; use on networks you
  trust.
- SSH passwords must be re-entered after a restart (Keychain support planned).
- File access is scoped by `assetProtocol.scope` in `tauri.conf.json`
  (defaults: home directory and `/Volumes`).

## Development

```bash
npm install
npm run tauri dev     # run in development
npm run tauri build   # build a release .app / .dmg
```

```
src-tauri/           Rust backend (Tauri 2)
  src/db.rs          SQLite schema + FTS5 + queries
  src/html.rs        <title>/heading/body-text extraction
  src/remote.rs      SSH/SFTP connection pool + remote:// protocol server
  src/watch.rs       native file watching → debounced incremental rescans
  src/lib.rs         folder scanning + Tauri commands
src/                 React frontend
  api.ts             invoke wrappers + local/remote URL conversion
  i18n.ts            UI strings (English default, Korean via system language)
  markdown.ts        markdown-it + highlight.js rendering + iframe source hook
  components/        Sidebar · Toolbar · FileGrid · FileCard · Viewer · modals
```

Viewer/thumbnail iframes are sandboxed without `allow-same-origin`, so
untrusted documents can't touch the app's privileges. Remote content is served
through a custom `remote://` protocol that proxies SFTP with the same CORS
posture as the asset protocol.

## License

[MIT](LICENSE)
