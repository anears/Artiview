import { t } from "../i18n";
import type { FileEntry } from "../types";
import { displayName } from "../types";
import { formatSize, formatTime, parentDir } from "../util";
import FileCard from "./FileCard";
import ForgetButton, { canForget } from "./ForgetButton";

interface Props {
  files: FileEntry[];
  layout: "grid" | "list";
  authEpoch: number;
  onOpen: (f: FileEntry) => void;
  onToggleFavorite: (f: FileEntry) => void;
  onForget: (f: FileEntry) => void;
}

export default function FileGrid({
  files,
  layout,
  authEpoch,
  onOpen,
  onToggleFavorite,
  onForget,
}: Props) {
  if (layout === "list") {
    return (
      <div className="list">
        {files.map((f) => (
          <div
            className={`row ${f.missing ? "missing" : ""}`}
            key={f.id}
            onClick={() => onOpen(f)}
            title={f.path}
          >
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
              <div className="row-name">
                {f.missing && <span className="missing-badge">{t("missingBadge")}</span>}
                {displayName(f)}
              </div>
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
            {canForget(f) ? (
              <ForgetButton file={f} className="row-remove" onForget={onForget}>
                ×
              </ForgetButton>
            ) : (
              <span className="row-remove-spacer" />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid">
      {files.map((f) => (
        <FileCard
          key={f.id}
          file={f}
          authEpoch={authEpoch}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
          onForget={onForget}
        />
      ))}
    </div>
  );
}
