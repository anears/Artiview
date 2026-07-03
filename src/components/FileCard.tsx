import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../types";
import { displayName, fileKind } from "../types";
import { useDocSource } from "../markdown";
import { formatTime, parentDir } from "../util";
import ForgetButton from "./ForgetButton";

// Thumbnails render the real HTML in an off-screen-sized iframe, then scale it
// down to the card width. This keeps previews always-accurate with no
// screenshot pipeline. Frames are mounted lazily as cards scroll into view.
const VW = 1280;
const VH = 800;

interface Props {
  file: FileEntry;
  onOpen: (f: FileEntry) => void;
  onToggleFavorite: (f: FileEntry) => void;
  onForget: (f: FileEntry) => void;
}

export default function FileCard({ file, onOpen, onToggleFavorite, onForget }: Props) {
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
  // The refresh key retries the fetch/probe when a rescan updates the entry.
  const doc = useDocSource(file.path, kind, ready, false, `${file.modified}-${file.missing}`);
  const frameProps = doc.src ? { src: doc.src } : { srcDoc: doc.srcDoc };
  // The preview fetch/probe failed, or rescan flagged the file missing and the
  // live result hasn't disproved it.
  const broken = doc.notFound || doc.loadError || (file.missing && !doc.ok);

  return (
    <div className={`card ${broken ? "missing" : ""}`} onClick={() => onOpen(file)} title={file.path}>
      <div className="thumb" ref={thumbRef}>
        {/*
          Thumbnails render untrusted HTML/Markdown (a .md can smuggle raw
          <script> through markdown-it). The sandbox OMITS `allow-same-origin`
          so the preview runs in an isolated origin with no access to the parent
          app or the Tauri IPC. Do not add `allow-same-origin`.
        */}
        {broken ? (
          <div className="thumb-missing">
            <div className="tm-ico">⚠</div>
            <div className="tm-text">파일을 찾을 수 없음</div>
            <ForgetButton file={file} className="tm-remove" onForget={onForget}>
              라이브러리에서 제거
            </ForgetButton>
          </div>
        ) : ready && (doc.src || doc.srcDoc) ? (
          <iframe
            className="thumb-frame"
            {...frameProps}
            sandbox="allow-scripts"
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
