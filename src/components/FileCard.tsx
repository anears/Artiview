import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../types";
import { displayName, fileKind } from "../types";
import { useDocSource } from "../markdown";
import { formatTime, parentDir } from "../util";

// Thumbnails render the real HTML in an off-screen-sized iframe, then scale it
// down to the card width. This keeps previews always-accurate with no
// screenshot pipeline. Frames are mounted lazily as cards scroll into view.
const VW = 1280;
const VH = 800;

interface Props {
  file: FileEntry;
  onOpen: (f: FileEntry) => void;
  onToggleFavorite: (f: FileEntry) => void;
}

export default function FileCard({ file, onOpen, onToggleFavorite }: Props) {
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && setInView(true),
      { rootMargin: "500px" },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const scale = width ? width / VW : 0;
  const kind = fileKind(file);
  const ready = inView && scale > 0;
  const doc = useDocSource(file.path, kind, ready);
  const frameProps = doc.src ? { src: doc.src } : { srcDoc: doc.srcDoc };

  return (
    <div className="card" onClick={() => onOpen(file)} title={file.path}>
      <div className="thumb" ref={thumbRef}>
        {ready && (doc.src || doc.srcDoc) ? (
          <iframe
            className="thumb-frame"
            {...frameProps}
            sandbox="allow-scripts allow-same-origin"
            scrolling="no"
            tabIndex={-1}
            title={file.name}
            style={{ width: VW, height: VH, transform: `scale(${scale})` }}
          />
        ) : (
          <div className="thumb-ph">{kind.toUpperCase()}</div>
        )}
        <button
          className={`star ${file.favorite ? "on" : ""}`}
          title={file.favorite ? "즐겨찾기 해제" : "즐겨찾기"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(file);
          }}
        >
          {file.favorite ? "★" : "☆"}
        </button>
      </div>
      <div className="card-body">
        <div className="card-title">{displayName(file)}</div>
        <div className="card-meta">
          <span className="card-dir">{parentDir(file.path)}</span>
        </div>
        <div className="card-foot">
          <span>{formatTime(file.modified)}</span>
          {file.tags.length > 0 && (
            <span className="card-tags">
              {file.tags.slice(0, 3).map((t) => (
                <span key={t} className="chip sm">
                  {t}
                </span>
              ))}
              {file.tags.length > 3 && <span className="chip sm">+{file.tags.length - 3}</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
