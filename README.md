# Artiview

**A local gallery for the HTML files your coding agents keep generating.**

[한국어 가이드](README.ko.md)

![Artiview demo — browse the library, full-text search, in-document find, light/dark theme](docs/demo.gif)

AI agents (Claude Code, Codex, custom pipelines…) leave a trail of HTML
reports, presentations and Markdown docs all over your disk — and your
servers. Artiview turns those folders into a browsable library: live-rendered
thumbnails, full-text search, favorites, tags, and SSH/SFTP remote folders
that work just like local ones.

Three promises the app is built around:

- **Your files are never modified or deleted.** Artiview only reads and
  indexes. Every "remove" action in the app removes an index entry, nothing
  else.
- **Everything stays local.** The index lives in a SQLite file on your
  machine. SSH passwords are never written to disk.
- **Untrusted documents are sandboxed.** Agent-generated HTML renders in
  iframes without `allow-same-origin`, so a malicious document can't touch
  the app or your system.

---

## Install

Download the latest build for your platform from
[Releases](https://github.com/anears/Artiview/releases):

| Platform | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `Artiview_x.y.z_aarch64.dmg` | Unsigned: on first launch, **right-click → Open**, or allow it in System Settings → Privacy & Security. |
| Windows | `Artiview_x.y.z_x64-setup.exe` or `.msi` | SmartScreen may warn on an unsigned installer — choose "More info → Run anyway". |
| Linux | `.AppImage`, `.deb`, or `.rpm` | AppImage: `chmod +x` and run. |

Windows and Linux builds are new and lightly tested — please
[open an issue](https://github.com/anears/Artiview/issues) if anything
misbehaves.

The UI is in English by default and switches to Korean automatically when
your system language is Korean. Light/dark theme follows your system. Both
can be changed anytime — see [Settings](#settings).

## Your first five minutes

1. **Register a folder.** Click **+** next to *Folders* in the sidebar and
   pick the directory where your agent output lands (e.g.
   `~/agent-reports`). Every `.html`, `.htm` and `.md` file under it —
   subfolders included — is scanned and indexed.
2. **Watch the grid fill up.** Each card is the *actual document*, rendered
   live at thumbnail size — not a stale screenshot.
3. **Leave it running.** Registered local folders are watched: when an agent
   writes a new file or rewrites an old one, it shows up in the library by
   itself within a couple of seconds. No refresh button needed.
4. **Click any card** to read the document in the built-in viewer. Press
   `Esc` to come back.

Have a one-off file outside your registered folders? **Open File** (top
right) views it immediately and remembers it under *Recent*.

## Browse your library

- **Views** — switch between *All Files*, *Recent* (things you've opened)
  and *Favorites* at the top of the sidebar.
- **Folder tree** — every registered root expands into its subfolders.
  Click one to see only the files beneath it.
- **Tags** — click a tag in the sidebar to filter to it.
- **Grid or list** — toggle with the ▦ / ☰ buttons. The list view adds
  sizes and exact times.
- **Sorting** — pick *Modified · Name · Size · Created · Last opened* in the
  toolbar and flip direction with ↑/↓. Your choice is remembered across
  restarts.
- Files are titled automatically: `<title>` tag → first heading → filename.

## Find anything

Two search layers:

- **Library search** (toolbar) — matches file names **and the full text of
  every document**. Type `revenue` and you'll find the report whose *body*
  mentions revenue, even if the filename is `output_final_v3.html`.
- **In-document find** — press `⌘/Ctrl+F` in the viewer. Matches are
  highlighted in place; `Enter` / `Shift+Enter` jumps between them, `Esc`
  closes.

## Read documents

Click a file to open the viewer:

| Control | What it does |
|---|---|
| ⌕ Find | Search inside the document (`⌘/Ctrl+F`) |
| # Tags | Add or remove tags |
| ★ | Toggle favorite |
| 🗑 Remove | Forget this file (the file on disk is untouched) |
| Browser ↗ | Open the original in your default browser (local files) |
| `Esc` | Back to the library |

Markdown renders GitHub-style with syntax-highlighted code, and relative
images/links inside documents resolve against the file's own folder — also
for files on remote servers.

## Organize with favorites and tags

- Hit **★** on any card, row, or in the viewer to pin a file to *Favorites*.
- Add tags via **# Tags** in the viewer. Tags appear in the sidebar with
  counts and act as one-click filters.
- Favorites and tags survive rescans, moved files, and unplugged drives.

## Use folders on a server (SSH/SFTP)

If your agents run on a remote machine, register their output folder over
SSH and use it like a local one:

1. Click **🌐** next to *Folders*.
2. **Connection** — `user@host`, `user@host:port`, or an alias from your
   `~/.ssh/config`.
3. **Remote path** — start typing an absolute path; subfolders are suggested
   as you type. `Tab` completes like a shell, `↑`/`↓` picks, `Enter`
   confirms.
4. **Authentication** — *Auto* tries ssh-agent, your ssh-config
   `IdentityFile`, then default keys (`id_ed25519` etc.). Or pick a key file
   (`.pem`) or a password explicitly.
5. **Add** — the first scan starts immediately.

Search, thumbnails, the viewer, and tags work exactly as for local folders;
images and CSS inside remote HTML are streamed over SFTP. Remote folders show
a 🌐 icon and an `@host` suffix in the sidebar.

**About passwords:** they are kept in memory only, for the current app run.
After a restart, a locked host shows 🔒 cards — click one and enter the
password to reconnect. Remote folders refresh via the **↻ Refresh** button
(only changes are re-scanned).

## When files go missing

Files get moved, renamed, deleted; drives get unplugged; servers go down.
Artiview never panics on your behalf:

- Missing files are **badged**, not purged — their tags and favorites are
  kept.
- The viewer offers **Retry** (transient problems) and **Remove from
  library** (intentional cleanup).
- If a whole drive or server disappears, its entries are flagged and fully
  recover on the next scan after it comes back.

## Settings

**⚙ Settings** (bottom of the sidebar):

- **Language** — Auto (system) / English / 한국어
- **Theme** — Auto (system) / Light / Dark

Changes apply when you press OK. Layout and sort preferences are remembered
automatically — there's nothing to configure.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl + F` | Find in the open document |
| `Enter` / `Shift+Enter` | Next / previous match |
| `Esc` | Close find bar → dialog → viewer, in that order |
| `Tab` | Complete the remote path (in the add-remote-folder dialog) |

## FAQ & troubleshooting

**Does Artiview ever modify or delete my files?**
No, never. It only reads them. All remove actions affect the index only.

**Where is my data stored?**
Folders, index, recents, favorites and tags live in `library.db` (SQLite) in
your platform's app-data directory. SSH passwords are not stored anywhere.

**A remote folder says "authentication failed".**
First check that `ssh <target>` works in a terminal. If your key is loaded in
ssh-agent (`ssh-add -l`) or set via `IdentityFile` in `~/.ssh/config`, *Auto*
will find it. Key files must not be world-readable (`chmod 600`).

**Some files were skipped during a scan.**
Remote scans are capped for safety: 16 levels deep, 20,000 entries, 50MB per
file.

**A document renders blank or broken.**
Try **Browser ↗** to compare with your browser's rendering, and **Retry** in
the viewer. Documents that depend on external network resources may render
differently offline.

## Known limitations

- Windows and Linux builds are new and lightly tested — issue reports
  welcome. macOS builds are Apple Silicon only.
- SSH host keys are not yet checked against `known_hosts`; use remote
  folders on networks you trust.
- SSH passwords must be re-entered after a restart (keychain integration is
  planned).
- File access is scoped by `assetProtocol.scope` in `tauri.conf.json`
  (defaults: home directory and removable-media mounts).

## For developers

```bash
npm install
npm run tauri dev     # run in development
npm run tauri build   # build a release bundle for your platform
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
untrusted documents can't touch the app's privileges. Remote content is
served through a custom `remote://` protocol that proxies SFTP with the same
CORS posture as the asset protocol. CI builds macOS/Linux/Windows bundles on
every PR; pushing a `v*` tag drafts a GitHub release with the bundles
attached.

## License

[MIT](LICENSE)
