import { useCallback, useEffect, useRef, useState } from "react";
import { openInBrowser } from "../api";
import { useDebounced } from "../hooks";
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
  const doc = useDocSource(file.path, kind, true, true); // findable: inject search support
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ total: 0, index: -1 });
  const debouncedQuery = useDebounced(query, 150);

  // Refs mirror state for the listeners below, which are registered once.
  const openRef = useRef(findOpen);
  openRef.current = findOpen;
  const queryRef = useRef(query);
  queryRef.current = query;

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ ...msg, __artiview: true }, "*");
  }, []);

  const openFind = useCallback(() => setFindOpen(true), []);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setResult({ total: 0, index: -1 });
    post({ type: "find-clear" });
  }, [post]);

  // ⌘/Ctrl+F opens search; Esc closes it. Capture phase + stopPropagation so
  // Esc here wins over App's "Esc closes the viewer" handler when search is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "f") {
        e.preventDefault();
        e.stopPropagation();
        openFind();
      } else if (k === "escape" && openRef.current) {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openFind, closeFind]);

  // Commands/keys raised from inside the iframe, plus match-count reports.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.__artiview !== true) return;
      switch (d.type) {
        case "find-result":
          setResult({ total: d.total, index: d.index });
          break;
        case "find-ready": // doc (re)loaded — re-apply an active query
          if (openRef.current && queryRef.current) post({ type: "find", query: queryRef.current });
          break;
        case "find-open":
          openFind();
          break;
        case "find-escape":
          if (openRef.current) closeFind();
          break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [openFind, closeFind, post]);

  // Focus the field when the bar opens.
  useEffect(() => {
    if (!findOpen) return;
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, [findOpen]);

  // Push the (debounced) query into the iframe while the bar is open.
  useEffect(() => {
    if (findOpen) post({ type: "find", query: debouncedQuery });
  }, [debouncedQuery, findOpen, post]);

  const hasQuery = query.trim().length > 0;
  const noMatch = hasQuery && result.total === 0;

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
          <button className="btn ghost" onClick={openFind} title="문서 내 검색 (⌘/Ctrl+F)">
            ⌕ 찾기
          </button>
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

      {findOpen && (
        <div className="find-bar" role="search">
          <span className="find-ico">⌕</span>
          <input
            ref={inputRef}
            type="text"
            className="find-input"
            placeholder="문서 내 검색…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                post({ type: "find-step", delta: e.shiftKey ? -1 : 1 });
              }
            }}
          />
          <span className={`find-count ${noMatch ? "none" : ""}`}>
            {hasQuery ? `${result.total ? result.index + 1 : 0}/${result.total}` : ""}
          </span>
          <button
            className="find-nav"
            title="이전 (Shift+Enter)"
            disabled={result.total === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => post({ type: "find-step", delta: -1 })}
          >
            ↑
          </button>
          <button
            className="find-nav"
            title="다음 (Enter)"
            disabled={result.total === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => post({ type: "find-step", delta: 1 })}
          >
            ↓
          </button>
          <button className="find-close" title="닫기 (Esc)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}

      <iframe
        ref={frameRef}
        className="viewer-frame"
        srcDoc={doc.srcDoc}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-downloads"
        title={file.name}
      />
    </div>
  );
}
