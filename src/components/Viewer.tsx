import { useCallback, useEffect, useRef, useState } from "react";
import { openInBrowser } from "../api";
import { useDebounced } from "../hooks";
import { useDocSource } from "../markdown";
import type { FileEntry } from "../types";
import { displayName, fileKind } from "../types";
import ForgetButton, { canForget } from "./ForgetButton";

interface Props {
  file: FileEntry;
  onClose: () => void;
  onToggleFavorite: (f: FileEntry) => void;
  onEditTags: (f: FileEntry) => void;
  onForget: (f: FileEntry) => void;
  onError: (e: unknown) => void;
}

export default function Viewer({
  file,
  onClose,
  onToggleFavorite,
  onEditTags,
  onForget,
  onError,
}: Props) {
  const kind = fileKind(file);
  // findable: inject search support. The refresh key retries the fetch when a
  // rescan / re-open updates the entry, so a restored file recovers in place.
  const doc = useDocSource(file.path, kind, true, true, `${file.modified}-${file.missing}`);
  // The live fetch is the ground truth: a stale DB `missing` flag only counts
  // while the fetch hasn't disproved it.
  const notFound = doc.notFound || (file.missing && !doc.ok && !doc.loading);
  const broken = notFound || doc.loadError;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const tryOpenInBrowser = () => openInBrowser(file.path).catch(onError);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ total: 0, index: -1 });
  const debouncedQuery = useDebounced(query, 150);

  // Refs mirror state for the listeners below, which are registered once.
  const openRef = useRef(findOpen);
  openRef.current = findOpen;
  const queryRef = useRef(query);
  queryRef.current = query;
  const brokenRef = useRef(broken);
  brokenRef.current = broken;

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
        // No find on a broken file: the bar wouldn't render, and the invisible
        // open state would swallow the next Escape meant to close the viewer.
        if (brokenRef.current) return;
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

  // If the document breaks while find is open, drop the now-invisible state.
  useEffect(() => {
    if (broken) closeFind();
  }, [broken, closeFind]);

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
          <button
            className="btn ghost"
            onClick={openFind}
            disabled={broken}
            title="문서 내 검색 (⌘/Ctrl+F)"
          >
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
          {canForget(file) && (
            <ForgetButton file={file} className="btn ghost danger" onForget={onForget}>
              🗑 제거
            </ForgetButton>
          )}
          <button className="btn" onClick={tryOpenInBrowser} title="브라우저로 열기">
            브라우저로 ↗
          </button>
        </div>
      </header>

      {findOpen && !broken && (
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

      {broken ? (
        <div className="viewer-missing">
          <div className="vm-card">
            <div className="vm-ico">⚠</div>
            <h2>{notFound ? "파일을 찾을 수 없습니다" : "파일을 불러오지 못했습니다"}</h2>
            {notFound ? (
              <p>
                이 위치에서 파일을 불러오지 못했어요. 이동·이름변경·삭제되었을 수 있습니다.
                원본을 다시 찾았다면 <strong>파일 열기</strong>로 다시 등록하세요.
              </p>
            ) : (
              // A render/transient failure is NOT proof the file is gone, so no
              // destructive remove action here — just non-destructive fallbacks.
              <p>파일은 존재하지만 내용을 표시하지 못했어요. 다시 열거나 브라우저로 열어 보세요.</p>
            )}
            <code className="vm-path">{file.path}</code>
            <div className="vm-actions">
              <button className="btn" onClick={doc.retry}>
                다시 시도
              </button>
              <button className="btn" onClick={tryOpenInBrowser}>
                브라우저로 열기 시도
              </button>
              {notFound && (
                <ForgetButton file={file} className="btn primary danger" onForget={onForget}>
                  라이브러리에서 제거
                </ForgetButton>
              )}
            </div>
          </div>
        </div>
      ) : (
        /*
          The viewer renders agent-generated (untrusted) HTML. The sandbox keeps
          scripts running (so dynamic reports work) but deliberately OMITS
          `allow-same-origin`: srcDoc is same-origin with the app shell, and
          combining same-origin with `allow-scripts` would let a malicious
          document remove its own sandbox and reach `window.parent` / the Tauri
          IPC. The find feature needs no same-origin access — it drives the
          injected script purely over postMessage. Do not add `allow-same-origin`.
        */
        <iframe
          ref={frameRef}
          className="viewer-frame"
          srcDoc={doc.srcDoc}
          sandbox="allow-scripts allow-popups allow-forms allow-modals allow-downloads"
          title={file.name}
        />
      )}
    </div>
  );
}
