import type { Folder, Nav, TagCount } from "../types";
import { basename } from "../util";

interface Props {
  nav: Nav;
  setNav: (n: Nav) => void;
  folders: Folder[];
  tags: TagCount[];
  onAddFolder: () => void;
  onRemoveFolder: (f: Folder) => void;
}

export default function Sidebar({
  nav,
  setNav,
  folders,
  tags,
  onAddFolder,
  onRemoveFolder,
}: Props) {
  const active = (kind: Nav["kind"], key?: number | string) =>
    nav.kind === kind &&
    (kind === "folder" ? nav.folderId === key : kind === "tag" ? nav.tag === key : true);

  return (
    <aside className="sidebar">
      <div className="brand">Artiview</div>

      <nav className="nav-group">
        <button className={`nav-item ${active("all") ? "active" : ""}`} onClick={() => setNav({ kind: "all" })}>
          <span className="nav-ico">▦</span> 전체
        </button>
        <button
          className={`nav-item ${active("recent") ? "active" : ""}`}
          onClick={() => setNav({ kind: "recent" })}
        >
          <span className="nav-ico">◷</span> 최근 본 파일
        </button>
        <button
          className={`nav-item ${active("favorites") ? "active" : ""}`}
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
        {folders.length === 0 && <div className="nav-empty">등록된 폴더 없음</div>}
        {folders.map((f) => (
          <div
            key={f.id}
            className={`nav-item folder ${active("folder", f.id) ? "active" : ""}`}
            onClick={() => setNav({ kind: "folder", folderId: f.id })}
            title={f.path}
          >
            <span className="nav-ico">📁</span>
            <span className="nav-label">{basename(f.path)}</span>
            <span className="nav-count">{f.file_count}</span>
            <button
              className="nav-remove"
              title="폴더 제거"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFolder(f);
              }}
            >
              ×
            </button>
          </div>
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
              className={`nav-item ${active("tag", t.name) ? "active" : ""}`}
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
