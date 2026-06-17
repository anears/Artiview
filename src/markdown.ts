import MarkdownIt from "markdown-it";
// `lib/common` ships the ~40 most-used languages instead of all ~190,
// which keeps the bundle small while covering everything agent docs use.
import hljs from "highlight.js/lib/common";
import { useEffect, useState } from "react";
import { fileSrc } from "./api";
import { injectFindScript, wrapHtmlForViewer } from "./find";
import { parentDir } from "./util";
// CSS is injected into the iframe document (it has its own DOM), so we pull the
// stylesheets in as strings via Vite's `?inline` import.
import githubCss from "github-markdown-css/github-markdown-dark.css?inline";
import hljsCss from "highlight.js/styles/github-dark.css?inline";

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
  const parts = `${dir}/${rel}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `/${out.join("/")}`;
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

const FRAME_CSS = `
  html, body { margin: 0; background: #0d1117; }
  .markdown-body {
    box-sizing: border-box;
    max-width: 980px;
    margin: 0 auto;
    padding: 40px 48px 64px;
  }
  .markdown-body img { background: transparent; }
`;

/** Render Markdown source into a full standalone HTML document for an iframe. */
export function renderMarkdownDoc(source: string, dir: string): string {
  const body = md.render(source, { dir });
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${githubCss}</style>
<style>${hljsCss}</style>
<style>${FRAME_CSS}</style>
</head>
<body><article class="markdown-body">${body}</article></body></html>`;
}

export type DocSource = { src?: string; srcDoc?: string; loading: boolean };

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
 */
export function useDocSource(
  path: string,
  kind: "html" | "md",
  enabled: boolean,
  findable = false,
): DocSource {
  const [srcDoc, setSrcDoc] = useState<string | undefined>();
  // HTML thumbnails render straight from the asset URL; everything else needs a
  // fetch + transform pass before it can be shown.
  const fetched = kind === "md" || findable;
  const [loading, setLoading] = useState(fetched);

  useEffect(() => {
    if (!fetched || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setSrcDoc(undefined);
    fetch(fileSrc(path))
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        let doc =
          kind === "md"
            ? renderMarkdownDoc(text, parentDir(path))
            : wrapHtmlForViewer(text, fileSrc(path));
        if (kind === "md" && findable) doc = injectFindScript(doc);
        setSrcDoc(doc);
      })
      .catch(() => {
        if (!cancelled) setSrcDoc("<p style='color:#f88;font-family:sans-serif;padding:24px'>불러오기 실패</p>");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, kind, enabled, fetched]);

  if (kind === "html" && !findable) return { src: fileSrc(path), loading: false };
  return { srcDoc, loading };
}
