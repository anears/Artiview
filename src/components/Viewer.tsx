import { useCallback, useEffect, useRef, useState } from "react";
import { isRemotePath, openInBrowser } from "../api";
import { useDebounced } from "../hooks";
import { t } from "../i18n";
import { useDocSource } from "../markdown";
import type { FileEntry } from "../types";
import { displayName, fileKind } from "../types";
import ForgetButton, { canForget } from "./ForgetButton";

interface Props {
  file: FileEntry;
  authEpoch: number;
  onClose: () => void;
  onToggleFavorite: (f: FileEntry) => void;
  onEditTags: (f: FileEntry) => void;
  onForget: (f: FileEntry) => void;
  onAuthNeeded: (hostkey: string) => void;
  onError: (e: unknown) => void;
}

export default function Viewer({
  file,
  authEpoch,
  onClose,
  onToggleFavorite,
  onEditTags,
  onForget,
  onAuthNeeded,
  onError,
}: Props) {
  const kind = fileKind(file);
  // No find on PDFs (the native renderer's page isn't ours to script into)
  // or images (no text to search).
  const findSupported = kind !== "pdf" && kind !== "img";
  const remote = isRemotePath(file.path);
  // findable: inject search support. The refresh key retries the fetch when a
  // rescan / re-open / login updates the entry, so it recovers in place.
  const doc = useDocSource(
    file.path,
    kind,
    true,
    true,
    `${file.modified}-${file.missing}-${authEpoch}`,
  );
  // The live fetch is the ground truth: a stale DB `missing` flag only counts
  // while the fetch hasn't disproved it (and a locked host proves nothing).
  const needsAuth = doc.needsAuth;
  const notFound = doc.notFound || (file.missing && !doc.ok && !doc.loading && !needsAuth);
  const broken = notFound || doc.loadError || needsAuth !== null;
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
  const canFindRef = useRef(!broken && findSupported);
  canFindRef.current = !broken && findSupported;

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
        // No find on a broken file or a PDF: the bar wouldn't render, and the
        // invisible open state would swallow the next Escape meant to close
        // the viewer.
        if (!canFindRef.current) return;
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

  // If the document breaks (or the entry switches to a PDF) while find is
  // open, drop the now-invisible state.
  useEffect(() => {
    if (broken || !findSupported) closeFind();
  }, [broken, findSupported, closeFind]);

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
        <button className="btn ghost" onClick={onClose} title={t("back")}>
          ‹ {t("back")}
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
          {findSupported && (
            <button
              className="btn ghost"
              onClick={openFind}
              disabled={broken}
              title={t("findTip")}
            >
              ⌕ {t("find")}
            </button>
          )}
          <button className="btn ghost" onClick={() => onEditTags(file)} title={t("editTagsTip")}>
            # {t("tags")}
          </button>
          <button
            className={`btn ghost ${file.favorite ? "fav-on" : ""}`}
            onClick={() => onToggleFavorite(file)}
            title={t("favoriteTip")}
          >
            {file.favorite ? "★" : "☆"}
          </button>
          {canForget(file) && (
            <ForgetButton file={file} className="btn ghost danger" onForget={onForget}>
              🗑 {t("remove")}
            </ForgetButton>
          )}
          {!remote && (
            <button className="btn" onClick={tryOpenInBrowser} title={t("openInBrowserTip")}>
              {t("openInBrowser")}
            </button>
          )}
        </div>
      </header>

      {findOpen && !broken && (
        <div className="find-bar" role="search">
          <span className="find-ico">⌕</span>
          <input
            ref={inputRef}
            type="text"
            className="find-input"
            placeholder={t("findPlaceholder")}
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
            title={t("findPrevTip")}
            disabled={result.total === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => post({ type: "find-step", delta: -1 })}
          >
            ↑
          </button>
          <button
            className="find-nav"
            title={t("findNextTip")}
            disabled={result.total === 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => post({ type: "find-step", delta: 1 })}
          >
            ↓
          </button>
          <button className="find-close" title={t("findCloseTip")} onClick={closeFind}>
            ×
          </button>
        </div>
      )}

      {broken ? (
        <div className="viewer-missing">
          <div className="vm-card">
            <div className="vm-ico">{needsAuth ? "🔒" : "⚠"}</div>
            <h2>
              {needsAuth
                ? t("viewerAuthTitle")
                : notFound
                  ? t("viewerNotFoundTitle")
                  : t("viewerErrorTitle")}
            </h2>
            {needsAuth ? (
              <p>
                <strong>{needsAuth}</strong>
                {t("viewerAuthBody")}
              </p>
            ) : notFound ? (
              <p>{t("viewerNotFoundBody")}</p>
            ) : (
              // A render/transient failure is NOT proof the file is gone, so no
              // destructive remove action here — just non-destructive fallbacks.
              <p>{t("viewerErrorBody")}</p>
            )}
            <code className="vm-path">{file.path}</code>
            <div className="vm-actions">
              {needsAuth ? (
                <button className="btn primary" onClick={() => onAuthNeeded(needsAuth)}>
                  {t("enterPassword")}
                </button>
              ) : (
                <button className="btn" onClick={doc.retry}>
                  {t("retry")}
                </button>
              )}
              {!remote && !needsAuth && (
                <button className="btn" onClick={tryOpenInBrowser}>
                  {t("tryInBrowser")}
                </button>
              )}
              {notFound && (
                <ForgetButton file={file} className="btn primary danger" onForget={onForget}>
                  {t("removeFromLibrary")}
                </ForgetButton>
              )}
            </div>
          </div>
        </div>
      ) : kind === "img" ? (
        /*
          Images render through <img>, which never executes scripts — not even
          inside an SVG — so no iframe/sandbox is needed here.
        */
        <div className="viewer-image">
          <img src={doc.src} alt={file.name} />
        </div>
      ) : kind === "pdf" ? (
        /*
          PDFs render via the webview's native PDF viewer, which refuses to run
          inside a sandboxed frame — so this frame has NO sandbox. That is safe
          only because nothing but a real PDF can ever load here: the probe in
          useDocSource verified the `%PDF-` magic bytes, and the remote protocol
          serves .pdf with a forced application/pdf content type. PDF bytes are
          rendered by the viewer, never executed as a page.
        */
        <iframe className="viewer-frame" src={doc.src} title={file.name} />
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
