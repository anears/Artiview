import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import FileGrid from "./components/FileGrid";
import PasswordModal from "./components/PasswordModal";
import RemoteFolderModal from "./components/RemoteFolderModal";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import TagEditor from "./components/TagEditor";
import Toolbar from "./components/Toolbar";
import Viewer from "./components/Viewer";
import { useDebounced } from "./hooks";
import { t } from "./i18n";
import { loadLayout, loadSort, saveLayout, saveSort } from "./settings";
import type { SortMap } from "./settings";
import type { DirCount, FileEntry, Folder, Nav, SortKey, SortSpec, TagCount } from "./types";
import { displayName } from "./types";
import { basename } from "./util";
import "./styles.css";

function App() {
  const [nav, setNav] = useState<Nav>({ kind: "all" });
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 200);
  // Layout and sort are viewing habits — restored from the previous run.
  const [layout, setLayout] = useState<"grid" | "list">(loadLayout);
  // Sort is scoped per view: a view absent from the map uses its own default
  // order (recent → last opened, others → modified). Sharing one global sort
  // would let a name/size choice made elsewhere override the recent view's
  // "most-recently-opened first" ordering.
  const [sorts, setSorts] = useState<SortMap>(loadSort);
  const sort = sorts[nav.kind] ?? null;
  useEffect(() => saveLayout(layout), [layout]);
  useEffect(() => saveSort(sorts), [sorts]);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dirs, setDirs] = useState<DirCount[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);

  const [openFile, setOpenFile] = useState<FileEntry | null>(null);
  const [tagEditFile, setTagEditFile] = useState<FileEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Remote (SSH) state: the add-folder modal, a pending password request
  // (hostkey), and an epoch bumped on login so visible documents refetch.
  const [remoteModalOpen, setRemoteModalOpen] = useState(false);
  const [authHost, setAuthHost] = useState<string | null>(null);
  const [authEpoch, setAuthEpoch] = useState(0);

  const fail = (e: unknown) => setError(String(e));

  const refreshSidebar = useCallback(async () => {
    try {
      const [fs, ds, ts] = await Promise.all([
        api.listFolders(),
        api.listDirs(),
        api.listTags(),
      ]);
      setFolders(fs);
      setDirs(ds);
      setTags(ts);
    } catch (e) {
      fail(e);
    }
  }, []);

  const argsFor = useCallback(
    (n: Nav, q: string, s: SortSpec | null): api.ListArgs => {
      const base = {
        query: q.trim() || null,
        ...(s ? { sort: s.key, ascending: s.asc } : {}),
      };
      switch (n.kind) {
        case "recent":
          return { view: "recent", ...base };
        case "favorites":
          return { view: "favorites", ...base };
        case "folder":
          return { view: "all", dir: n.folderPath, ...base };
        case "tag":
          return { view: "all", tag: n.tag, ...base };
        default:
          return { view: "all", ...base };
      }
    },
    [],
  );

  const refreshFiles = useCallback(async () => {
    try {
      const next = await api.listFiles(argsFor(nav, debouncedQuery, sort));
      setFiles(next);
      // Keep the open viewer's entry in sync — e.g. a rescan just cleared its
      // missing flag or re-indexed it. Absence just means it fell out of the
      // current filter, so keep the stale entry rather than closing the viewer.
      setOpenFile((prev) => (prev ? (next.find((f) => f.id === prev.id) ?? prev) : prev));
    } catch (e) {
      fail(e);
    }
  }, [nav, debouncedQuery, sort, argsFor]);

  useEffect(() => {
    refreshSidebar();
  }, [refreshSidebar]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // The backend watches registered local folders and rescans on changes —
  // refetch whenever it reports that the library moved under us.
  useEffect(() => {
    const unlisten = listen("library-changed", () => {
      refreshSidebar();
      refreshFiles();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [refreshSidebar, refreshFiles]);

  // ---- mutations (optimistic where possible) ----
  const patchFile = (id: number, patch: Partial<FileEntry>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setOpenFile((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  };

  const handleOpen = async (f: FileEntry) => {
    setOpenFile(f);
    try {
      await api.recordOpen(f.id);
    } catch (e) {
      fail(e);
    }
  };

  const toggleFavorite = async (f: FileEntry) => {
    const next = !f.favorite;
    patchFile(f.id, { favorite: next });
    if (nav.kind === "favorites" && !next) {
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    }
    try {
      await api.setFavorite(f.id, next);
    } catch (e) {
      fail(e);
    }
  };

  const forgetFile = async (f: FileEntry) => {
    if (!confirm(t("confirmForget")(displayName(f)))) return;
    // Optimistic: drop it from the list. The viewer only closes once the
    // delete lands, so a failure doesn't kick the user out of the document.
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    try {
      await api.forgetFile(f.id);
      setOpenFile((prev) => (prev && prev.id === f.id ? null : prev));
      await refreshSidebar();
    } catch (e) {
      fail(e);
      await refreshFiles(); // resync if the delete didn't take
    }
  };

  const saveTags = async (f: FileEntry, tagList: string[]) => {
    patchFile(f.id, { tags: tagList });
    try {
      await api.setFileTags(f.id, tagList);
      await refreshSidebar();
      if (nav.kind === "tag") await refreshFiles();
    } catch (e) {
      fail(e);
    }
  };

  const addFolder = async () => {
    try {
      const path = await api.pickFolder();
      if (!path) return;
      setScanning(true);
      await api.addFolder(path);
      await refreshSidebar();
      await refreshFiles();
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
    }
  };

  const removeFolder = async (f: Folder) => {
    if (!confirm(t("confirmRemoveFolder")(basename(f.path)))) return;
    try {
      await api.removeFolder(f.id);
      const root = f.path.replace(/\/+$/, "");
      if (
        nav.kind === "folder" &&
        nav.folderPath &&
        (nav.folderPath === root || nav.folderPath.startsWith(root + "/"))
      ) {
        setNav({ kind: "all" });
      }
      await refreshSidebar();
      await refreshFiles();
    } catch (e) {
      fail(e);
    }
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api.rescan();
      await refreshSidebar();
      await refreshFiles();
      // A locked remote host blocks its folders' scan — ask for its password.
      if (r.needs_auth.length > 0) setAuthHost(r.needs_auth[0]);
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
    }
  };

  const submitPassword = async (hostkey: string, password: string) => {
    setAuthHost(null);
    try {
      await api.setRemotePassword(hostkey, password);
      // Refetch everything visible with the fresh credentials, and rescan so
      // folders that were locked get indexed (which also re-prompts if more
      // hosts still need a password).
      setAuthEpoch((e) => e + 1);
      await rescan();
    } catch (e) {
      fail(e);
    }
  };

  const openFilePicker = async () => {
    try {
      const path = await api.pickHtmlFile();
      if (!path) return;
      const entry = await api.openPath(path);
      setOpenFile(entry);
      await refreshSidebar();
      await refreshFiles();
    } catch (e) {
      fail(e);
    }
  };

  // Escape closes the topmost modal / viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (authHost) setAuthHost(null);
      else if (remoteModalOpen) setRemoteModalOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (tagEditFile) setTagEditFile(null);
      else if (openFile) setOpenFile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, tagEditFile, remoteModalOpen, settingsOpen, authHost]);

  // What the toolbar shows while sort is still the view default.
  const effectiveSort: SortSpec = useMemo(
    () =>
      sort ?? (nav.kind === "recent" ? { key: "opened", asc: false } : { key: "modified", asc: false }),
    [sort, nav.kind],
  );

  const changeSortKey = (key: SortKey) => {
    // Names read naturally ascending; dates and sizes newest/largest first.
    // Scoped to the active view so other views keep their own order.
    setSorts((prev) => ({ ...prev, [nav.kind]: { key, asc: key === "name" } }));
  };

  const toggleSortDir = () =>
    setSorts((prev) => ({ ...prev, [nav.kind]: { ...effectiveSort, asc: !effectiveSort.asc } }));

  const title = useMemo(() => {
    switch (nav.kind) {
      case "recent":
        return t("navRecent");
      case "favorites":
        return t("navFavorites");
      case "folder":
        return nav.folderPath ? basename(nav.folderPath) : t("titleFolder");
      case "tag":
        return `# ${nav.tag}`;
      default:
        return t("navAll");
    }
  }, [nav, folders]);

  const showOnboarding =
    folders.length === 0 && files.length === 0 && !debouncedQuery.trim() && nav.kind === "all";

  return (
    <div className="app">
      <Sidebar
        nav={nav}
        setNav={setNav}
        folders={folders}
        dirs={dirs}
        tags={tags}
        onAddFolder={addFolder}
        onAddRemoteFolder={() => setRemoteModalOpen(true)}
        onRemoveFolder={removeFolder}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        <Toolbar
          title={title}
          count={files.length}
          query={query}
          setQuery={setQuery}
          layout={layout}
          setLayout={setLayout}
          sort={effectiveSort}
          onSortKey={changeSortKey}
          onSortDir={toggleSortDir}
          onOpenFile={openFilePicker}
          onRescan={rescan}
          scanning={scanning}
        />

        <div className="content">
          {showOnboarding ? (
            <div className="onboarding">
              <div className="onboarding-card">
                <h2>{t("onboardingTitle")}</h2>
                <p>{t("onboardingBody")}</p>
                <div className="onboarding-actions">
                  <button className="btn primary" onClick={addFolder}>
                    {t("onboardingAddFolder")}
                  </button>
                  <button className="btn" onClick={openFilePicker}>
                    {t("onboardingOpenFile")}
                  </button>
                </div>
              </div>
            </div>
          ) : files.length === 0 ? (
            <div className="empty">
              {debouncedQuery.trim() ? t("emptySearch") : t("emptyList")}
            </div>
          ) : (
            <FileGrid
              files={files}
              layout={layout}
              authEpoch={authEpoch}
              onOpen={handleOpen}
              onToggleFavorite={toggleFavorite}
              onForget={forgetFile}
            />
          )}
        </div>
      </main>

      {openFile && (
        <Viewer
          file={openFile}
          authEpoch={authEpoch}
          onClose={() => setOpenFile(null)}
          onToggleFavorite={toggleFavorite}
          onEditTags={(f) => setTagEditFile(f)}
          onForget={forgetFile}
          onAuthNeeded={(hk) => setAuthHost(hk)}
          onError={fail}
        />
      )}

      {tagEditFile && (
        <div className="modal-backdrop" onClick={() => setTagEditFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>{t("editTags")}</span>
              <button className="mini-btn" onClick={() => setTagEditFile(null)}>
                ×
              </button>
            </div>
            <div className="modal-sub">{displayName(tagEditFile)}</div>
            <TagEditor
              tags={tagEditFile.tags}
              onChange={(t) => {
                setTagEditFile({ ...tagEditFile, tags: t });
                saveTags(tagEditFile, t);
              }}
            />
          </div>
        </div>
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {remoteModalOpen && (
        <RemoteFolderModal
          onClose={() => setRemoteModalOpen(false)}
          onAdded={async () => {
            setRemoteModalOpen(false);
            await refreshSidebar();
            await refreshFiles();
          }}
        />
      )}

      {authHost && (
        <PasswordModal
          hostkey={authHost}
          onSubmit={(pw) => submitPassword(authHost, pw)}
          onCancel={() => setAuthHost(null)}
        />
      )}

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
