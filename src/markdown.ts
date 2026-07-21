import MarkdownIt from "markdown-it";
// `lib/common` ships the ~40 most-used languages instead of all ~190,
// which keeps the bundle small while covering everything agent docs use.
import hljs from "highlight.js/lib/common";
import { useCallback, useEffect, useState } from "react";
import { fileSrc, isRemotePath, SFTP_PREFIX } from "./api";
import { injectFindScript, wrapHtmlForViewer } from "./find";
import type { FileKind } from "./types";
import { parentDir } from "./util";
// CSS is injected into the iframe document (it has its own DOM, where the
// app's CSS variables don't reach), so we pull both palettes in as strings via
// Vite's `?inline` import and pick one per render.
import githubDarkCss from "github-markdown-css/github-markdown-dark.css?inline";
import githubLightCss from "github-markdown-css/github-markdown-light.css?inline";
import hljsDarkCss from "highlight.js/styles/github-dark.css?inline";
import hljsLightCss from "highlight.js/styles/github.css?inline";
import { resolvedTheme } from "./theme";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through */
      }
    }
    return ""; // let markdown-it escape it
  },
});

// Resolve relative image/link URLs to absolute asset URLs so that
// `![](./fig.png)` inside a Markdown file actually loads from its folder.
function isAbsoluteRef(url: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(url) || // http:, https:, data:, mailto:, asset:, …
    url.startsWith("//") ||
    url.startsWith("#")
  );
}

function joinPath(dir: string, rel: string): string {
  // A remote dir carries an sftp://<target> prefix that must survive
  // normalization untouched — `..` may not climb past the target.
  let prefix = "";
  if (isRemotePath(dir)) {
    const rest = dir.slice(SFTP_PREFIX.length);
    const slash = rest.indexOf("/");
    prefix = SFTP_PREFIX + (slash < 0 ? rest : rest.slice(0, slash));
    dir = slash < 0 ? "" : rest.slice(slash);
  }
  const parts = `${dir}/${rel}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `${prefix}/${out.join("/")}`;
}

function resolveRef(url: string, dir: string): string {
  if (!url || isAbsoluteRef(url)) return url;
  try {
    return fileSrc(joinPath(dir, decodeURI(url)));
  } catch {
    return url;
  }
}

// Patch the image/link renderers once to rewrite relative refs using env.dir.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const i = token.attrIndex("src");
  if (i >= 0 && env?.dir) token.attrs![i][1] = resolveRef(token.attrs![i][1], env.dir);
  return defaultImage(tokens, idx, options, env, self);
};

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const i = token.attrIndex("href");
  if (i >= 0 && env?.dir) {
    const href = token.attrs![i][1];
    if (!isAbsoluteRef(href)) token.attrs![i][1] = resolveRef(href, env.dir);
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const frameCss = (bg: string) => `
  html, body { margin: 0; background: ${bg}; }
  .markdown-body {
    box-sizing: border-box;
    max-width: 980px;
    margin: 0 auto;
    padding: 40px 48px 64px;
  }
  .markdown-body img { background: transparent; }
`;

/** Render Markdown source into a full standalone HTML document for an iframe,
 * styled for the theme in effect at render time. */
export function renderMarkdownDoc(source: string, dir: string): string {
  const body = md.render(source, { dir });
  const dark = resolvedTheme() === "dark";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${dark ? githubDarkCss : githubLightCss}</style>
<style>${dark ? hljsDarkCss : hljsLightCss}</style>
<style>${frameCss(dark ? "#0d1117" : "#ffffff")}</style>
</head>
<body><article class="markdown-body">${body}</article></body></html>`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Render plain text into a full standalone HTML document for an iframe,
 * styled for the theme in effect at render time. */
export function renderTextDoc(source: string): string {
  const dark = resolvedTheme() === "dark";
  const [bg, fg] = dark ? ["#0d1117", "#e6edf3"] : ["#ffffff", "#1f2328"];
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; background: ${bg}; }
  pre {
    box-sizing: border-box;
    max-width: 980px;
    margin: 0 auto;
    padding: 40px 48px 64px;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: ${fg};
  }
</style>
</head>
<body><pre>${escapeHtml(source)}</pre></body></html>`;
}

export type DocSource = {
  src?: string;
  srcDoc?: string;
  loading: boolean;
  /** The last fetch/probe positively confirmed the file is readable. */
  ok: boolean;
  /** The asset protocol answered 404 — the file is gone from its path. */
  notFound: boolean;
  /** Fetch/render failed for a reason other than the file being gone. */
  loadError: boolean;
  /** Remote host needs a password (401): its hostkey, else null. */
  needsAuth: string | null;
  /** Re-run the fetch/probe, e.g. from a retry affordance on an error card. */
  retry: () => void;
};

/** First `n` bytes of a response body as a binary string, cancelling the rest. */
async function readHead(r: Response, n: number): Promise<string> {
  const reader = r.body?.getReader();
  if (!reader) return "";
  let head = new Uint8Array(0);
  try {
    while (head.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(head.length + value.length);
      merged.set(head);
      merged.set(value, head.length);
      head = merged;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return String.fromCharCode(...head.slice(0, n));
}

/**
 * Resolve what to feed an <iframe> for a file:
 *  - Markdown → fetched + rendered HTML as srcDoc (only when `enabled`)
 *  - HTML, thumbnails (`findable` off) → the asset URL directly (native render)
 *  - HTML, viewer (`findable` on) → fetched + wrapped as srcDoc so we can inject
 *    the find script into the markup (impossible when the file is loaded
 *    directly via its asset URL). The viewer iframe is sandboxed WITHOUT
 *    `allow-same-origin`, so even though srcDoc shares the app's origin the
 *    untrusted document cannot reach the parent or the Tauri IPC; the find
 *    script communicates with the parent only over postMessage. A `<base>` set
 *    to the file's own asset URL keeps relative resources resolving as before.
 *  - Plain text → fetched + escaped into a `<pre>` document as srcDoc, exactly
 *    the Markdown flow (so find works in the viewer).
 *  - PDF → the asset URL directly, always: the webview's native PDF renderer
 *    does the work, so there is no markup to transform or inject into. The
 *    probe additionally verifies the `%PDF-` magic — the PDF frame renders
 *    unsandboxed (native PDF viewers don't run inside sandboxed frames), so a
 *    mislabeled .pdf that would come back as text/html must never reach it.
 *  - Images → the asset URL directly; callers render it via <img>, which
 *    never executes scripts (not even inside an SVG), so no iframe is needed.
 */
export function useDocSource(
  path: string,
  kind: FileKind,
  enabled: boolean,
  findable = false,
  /** Change to force a refetch, e.g. after a rescan updates the file entry. */
  refreshKey: unknown = 0,
): DocSource {
  const [srcDoc, setSrcDoc] = useState<string | undefined>();
  // HTML thumbnails, PDFs and images render straight from the asset URL;
  // everything else needs a fetch + transform pass before it can be shown.
  const fetched = kind === "md" || kind === "txt" || (kind === "html" && findable);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "notfound" | "auth" | "error">(
    enabled && fetched ? "loading" : "idle",
  );
  const [authHost, setAuthHost] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setSrcDoc(undefined);
    setStatus("loading");
    // A moved/deleted file resolves to a 404; a locked remote host answers 401
    // with its hostkey as the body; anything else (transient failure, render
    // throw) is not proof the file is gone.
    const failWith = (r?: Response) => {
      if (!cancelled) setStatus(r?.status === 404 ? "notfound" : "error");
    };
    const authWith = async (r: Response) => {
      const hk = await r.text().catch(() => "");
      if (!cancelled) {
        setAuthHost(hk || null);
        setStatus(hk ? "auth" : "error");
      }
    };

    if (!fetched) {
      // The iframe loads the asset URL natively, where a missing file fails
      // silently — probe for existence so the card can show its broken state.
      fetch(fileSrc(path))
        .then(async (r) => {
          if (r.status === 401) return authWith(r);
          if (!r.ok) {
            r.body?.cancel().catch(() => {});
            return failWith(r);
          }
          if (kind === "pdf") {
            // Gate the unsandboxed PDF frame on the file really being a PDF
            // (see the docs above) — anything else shows the error card.
            const head = await readHead(r, 5).catch(() => "");
            if (!cancelled) setStatus(head === "%PDF-" ? "ok" : "error");
            return;
          }
          r.body?.cancel().catch(() => {});
          if (!cancelled) setStatus("ok");
        })
        .catch(() => failWith());
    } else {
      fetch(fileSrc(path))
        .then((r) => {
          if (!r.ok) {
            if (r.status === 401) authWith(r);
            else failWith(r);
            return undefined;
          }
          return r.text();
        })
        .then((text) => {
          if (cancelled || text === undefined) return;
          let doc =
            kind === "md"
              ? renderMarkdownDoc(text, parentDir(path))
              : kind === "txt"
                ? renderTextDoc(text)
                : wrapHtmlForViewer(text, fileSrc(path));
          if (kind !== "html" && findable) doc = injectFindScript(doc);
          setSrcDoc(doc);
          setStatus("ok");
        })
        .catch(() => failWith());
    }
    return () => {
      cancelled = true;
    };
  }, [path, kind, enabled, fetched, findable, refreshKey, attempt]);

  const state = {
    loading: status === "loading",
    ok: status === "ok",
    notFound: status === "notfound",
    loadError: status === "error",
    needsAuth: status === "auth" ? authHost : null,
    retry,
  };
  // The asset URL can render immediately; the existence probe reports async.
  if (!fetched) return { src: fileSrc(path), ...state, loading: false };
  return { srcDoc, ...state };
}
