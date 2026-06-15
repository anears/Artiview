import type { FileEntry } from "../types";
import { displayName } from "../types";
import { formatSize, formatTime, parentDir } from "../util";
import FileCard from "./FileCard";

interface Props {
  files: FileEntry[];
  layout: "grid" | "list";
  onOpen: (f: FileEntry) => void;
  onToggleFavorite: (f: FileEntry) => void;
}

export default function FileGrid({ files, layout, onOpen, onToggleFavorite }: Props) {
  if (layout === "list") {
    return (
      <div className="list">
        {files.map((f) => (
          <div className="row" key={f.id} onClick={() => onOpen(f)} title={f.path}>
            <button
              className={`star ${f.favorite ? "on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(f);
              }}
            >
              {f.favorite ? "★" : "☆"}
            </button>
            <div className="row-main">
              <div className="row-name">{displayName(f)}</div>
              <div className="row-dir">{parentDir(f.path)}</div>
            </div>
            <div className="row-tags">
              {f.tags.map((t) => (
                <span key={t} className="chip sm">
                  {t}
                </span>
              ))}
            </div>
            <div className="row-size">{formatSize(f.size)}</div>
            <div className="row-time">{formatTime(f.modified)}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid">
      {files.map((f) => (
        <FileCard key={f.id} file={f} onOpen={onOpen} onToggleFavorite={onToggleFavorite} />
      ))}
    </div>
  );
}
