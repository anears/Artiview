import { useEffect, useMemo, useState } from "react";
import { buildFolderTree } from "../foldertree";
import type { DirCount, Folder, FolderNode, Nav, TagCount } from "../types";

interface Props {
  nav: Nav;
  setNav: (n: Nav) => void;
  folders: Folder[];
  dirs: DirCount[];
  tags: TagCount[];
  onAddFolder: () => void;
  onRemoveFolder: (f: Folder) => void;
}

export default function Sidebar({
  nav,
  setNav,
  folders,
  dirs,
  tags,
  onAddFolder,
  onRemoveFolder,
}: Props) {
  const tree = useMemo(() => buildFolderTree(folders, dirs), [folders, dirs]);

  // Roots are expanded by default; user toggles are preserved across refreshes.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const r of tree) next.add(r.path);
      return next;
    });
  }, [folders]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const activeView = (kind: Nav["kind"]) => nav.kind === kind;

  return (
    <aside className="sidebar">
      <div className="brand">Artiview</div>

      <nav className="nav-group">
        <button className={`nav-item ${activeView("all") ? "active" : ""}`} onClick={() => setNav({ kind: "all" })}>
          <span className="nav-ico">▦</span> 전체
        </button>
        <button
          className={`nav-item ${activeView("recent") ? "active" : ""}`}
          onClick={() => setNav({ kind: "recent" })}
        >
          <span className="nav-ico">◷</span> 최근 본 파일
        </button>
        <button
          className={`nav-item ${activeView("favorites") ? "active" : ""}`}
          onClick={() => setNav({ kind: "favorites" })}
        >
          <span className="nav-ico">★</span> 즐겨찾기
        </button>
      </nav>

      <div className="nav-section">
        <div className="nav-section-head">
          <span>폴더</span>
          <button className="mini-btn" title="폴더 추가" onClick={onAddFolder}>
            +
          </button>
        </div>
        {tree.length === 0 && <div className="nav-empty">등록된 폴더 없음</div>}
        {tree.map((root) => (
          <TreeNode
            key={root.path}
            node={root}
            depth={0}
            nav={nav}
            setNav={setNav}
            expanded={expanded}
            toggle={toggle}
            folders={folders}
            onRemoveFolder={onRemoveFolder}
          />
        ))}
      </div>

      {tags.length > 0 && (
        <div className="nav-section">
          <div className="nav-section-head">
            <span>태그</span>
          </div>
          {tags.map((t) => (
            <div
              key={t.name}
              className={`nav-item ${nav.kind === "tag" && nav.tag === t.name ? "active" : ""}`}
              onClick={() => setNav({ kind: "tag", tag: t.name })}
            >
              <span className="nav-ico">#</span>
              <span className="nav-label">{t.name}</span>
              <span className="nav-count">{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

interface NodeProps {
  node: FolderNode;
  depth: number;
  nav: Nav;
  setNav: (n: Nav) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
  folders: Folder[];
  onRemoveFolder: (f: Folder) => void;
}

function TreeNode({ node, depth, nav, setNav, expanded, toggle, folders, onRemoveFolder }: NodeProps) {
  const isRoot = depth === 0;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.path);
  const active = nav.kind === "folder" && nav.folderPath === node.path;

  return (
    <>
      <div
        className={`nav-item folder ${active ? "active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setNav({ kind: "folder", folderPath: node.path })}
        title={node.path}
      >
        <button
          className="tree-caret"
          style={{ visibility: hasChildren ? "visible" : "hidden" }}
          onClick={(e) => {
            e.stopPropagation();
            toggle(node.path);
          }}
        >
          {isOpen ? "▾" : "▸"}
        </button>
        <span className="nav-ico">📁</span>
        <span className="nav-label">{node.name}</span>
        <span className="nav-count">{node.count}</span>
        {isRoot && (
          <button
            className="nav-remove"
            title="폴더 제거"
            onClick={(e) => {
              e.stopPropagation();
              const f = folders.find((x) => x.id === node.rootId);
              if (f) onRemoveFolder(f);
            }}
          >
            ×
          </button>
        )}
      </div>
      {isOpen &&
        node.children.map((c) => (
          <TreeNode
            key={c.path}
            node={c}
            depth={depth + 1}
            nav={nav}
            setNav={setNav}
            expanded={expanded}
            toggle={toggle}
            folders={folders}
            onRemoveFolder={onRemoveFolder}
          />
        ))}
    </>
  );
}
