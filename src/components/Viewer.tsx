import { openInBrowser } from "../api";
import { useDocSource } from "../markdown";
import type { FileEntry } from "../types";
import { displayName, fileKind } from "../types";

interface Props {
  file: FileEntry;
  onClose: () => void;
  onToggleFavorite: (f: FileEntry) => void;
  onEditTags: (f: FileEntry) => void;
}

export default function Viewer({ file, onClose, onToggleFavorite, onEditTags }: Props) {
  const kind = fileKind(file);
  const doc = useDocSource(file.path, kind, true);
  const frameProps = doc.src ? { src: doc.src } : { srcDoc: doc.srcDoc };

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <button className="btn ghost" onClick={onClose} title="뒤로">
          ‹ 뒤로
        </button>
        <div className="viewer-title" title={file.path}>
          <div className="vt-name">
            <span className={`kind-badge ${kind}`}>{kind.toUpperCase()}</span>
            {displayName(file)}
          </div>
          <div className="vt-path">{file.path}</div>
        </div>
        <div className="viewer-actions">
          {file.tags.map((t) => (
            <span key={t} className="chip sm">
              {t}
            </span>
          ))}
          <button className="btn ghost" onClick={() => onEditTags(file)} title="태그 편집">
            # 태그
          </button>
          <button
            className={`btn ghost ${file.favorite ? "fav-on" : ""}`}
            onClick={() => onToggleFavorite(file)}
            title="즐겨찾기"
          >
            {file.favorite ? "★" : "☆"}
          </button>
          <button className="btn" onClick={() => openInBrowser(file.path)} title="브라우저로 열기">
            브라우저로 ↗
          </button>
        </div>
      </header>
      <iframe
        className="viewer-frame"
        {...frameProps}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads"
        title={file.name}
      />
    </div>
  );
}
