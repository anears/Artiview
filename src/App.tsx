import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "./api";
import FileGrid from "./components/FileGrid";
import Sidebar from "./components/Sidebar";
import TagEditor from "./components/TagEditor";
import Toolbar from "./components/Toolbar";
import Viewer from "./components/Viewer";
import { useDebounced } from "./hooks";
import type { DirCount, FileEntry, Folder, Nav, TagCount } from "./types";
import { displayName } from "./types";
import { basename } from "./util";
import "./styles.css";

function App() {
  const [nav, setNav] = useState<Nav>({ kind: "all" });
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 200);
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [dirs, setDirs] = useState<DirCount[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);

  const [openFile, setOpenFile] = useState<FileEntry | null>(null);
  const [tagEditFile, setTagEditFile] = useState<FileEntry | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    (n: Nav, q: string): api.ListArgs => {
      const base = { query: q.trim() || null };
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
      setFiles(await api.listFiles(argsFor(nav, debouncedQuery)));
    } catch (e) {
      fail(e);
    }
  }, [nav, debouncedQuery, argsFor]);

  useEffect(() => {
    refreshSidebar();
  }, [refreshSidebar]);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

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
    if (
      !confirm(
        `'${displayName(f)}'을(를) 라이브러리에서 제거할까요?\n(원본 파일은 삭제되지 않습니다)`,
      )
    )
      return;
    // Optimistic: drop it from the list and close the viewer if it was open.
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
    setOpenFile((prev) => (prev && prev.id === f.id ? null : prev));
    try {
      await api.forgetFile(f.id);
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
    if (!confirm(`'${basename(f.path)}' 폴더를 목록에서 제거할까요?\n(원본 파일은 삭제되지 않습니다)`)) return;
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
      await api.rescan();
      await refreshSidebar();
      await refreshFiles();
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
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

  // Escape closes the open modal / viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (tagEditFile) setTagEditFile(null);
      else if (openFile) setOpenFile(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, tagEditFile]);

  const title = useMemo(() => {
    switch (nav.kind) {
      case "recent":
        return "최근 본 파일";
      case "favorites":
        return "즐겨찾기";
      case "folder":
        return nav.folderPath ? basename(nav.folderPath) : "폴더";
      case "tag":
        return `# ${nav.tag}`;
      default:
        return "전체";
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
        onRemoveFolder={removeFolder}
      />

      <main className="main">
        <Toolbar
          title={title}
          count={files.length}
          query={query}
          setQuery={setQuery}
          layout={layout}
          setLayout={setLayout}
          onOpenFile={openFilePicker}
          onRescan={rescan}
          scanning={scanning}
        />

        <div className="content">
          {showOnboarding ? (
            <div className="onboarding">
              <div className="onboarding-card">
                <h2>라이브러리가 비어 있어요</h2>
                <p>
                  에이전트 결과물이 쌓이는 폴더를 등록하면 HTML·Markdown 파일을
                  자동으로 스캔해 목록·검색·썸네일을 만들어 드립니다.
                </p>
                <div className="onboarding-actions">
                  <button className="btn primary" onClick={addFolder}>
                    폴더 추가
                  </button>
                  <button className="btn" onClick={openFilePicker}>
                    파일 하나 열기
                  </button>
                </div>
              </div>
            </div>
          ) : files.length === 0 ? (
            <div className="empty">
              {debouncedQuery.trim() ? "검색 결과가 없습니다." : "표시할 파일이 없습니다."}
            </div>
          ) : (
            <FileGrid
              files={files}
              layout={layout}
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
          onClose={() => setOpenFile(null)}
          onToggleFavorite={toggleFavorite}
          onEditTags={(f) => setTagEditFile(f)}
          onForget={forgetFile}
        />
      )}

      {tagEditFile && (
        <div className="modal-backdrop" onClick={() => setTagEditFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>태그 편집</span>
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

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
