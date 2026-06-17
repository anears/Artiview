// In-document find for the viewer iframe.
//
// `FIND_SCRIPT` is a self-contained script injected into the rendered document
// (both Markdown and HTML). It highlights matches, tracks a "current" match,
// and talks to the parent window over postMessage. The viewer (parent) owns the
// search-bar UI and drives this script with commands.
//
// Message protocol — every message carries `__artiview: true`:
//   parent → frame: { type: "find",  query }        run / refresh a search
//                   { type: "find-step", delta }     move current match by ±1
//                   { type: "find-clear" }           remove all highlights
//                   { type: "find-ping" }            re-emit the latest result
//   frame → parent: { type: "find-ready" }                 script is live
//                   { type: "find-result", total, index }  match count + cursor
//                   { type: "find-open" }                  ⌘/Ctrl+F in the frame
//                   { type: "find-escape" }                Esc pressed in frame

export const FIND_CHANNEL = "__artiview" as const;

// NOTE: keep this body free of backticks and `${...}` so it can live inside the
// template literal below. It runs in the iframe, not in the app bundle.
export const FIND_SCRIPT = `
(function () {
  if (window.__artiviewFind) return;
  window.__artiviewFind = true;

  var MARK = "artiview-find-mark";
  var CURRENT = "artiview-find-current";
  var marks = [];
  var cur = -1;
  var query = "";

  var style = document.createElement("style");
  style.textContent =
    "mark." + MARK + "{background:#ffd84d;color:#1a1a1a;border-radius:2px;padding:0 1px;}" +
    "mark." + CURRENT + "{background:#ff8a00;color:#1a1a1a;box-shadow:0 0 0 2px rgba(255,138,0,.55);}";

  function ensureStyle() {
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  function send(msg) {
    msg.__artiview = true;
    try { parent.postMessage(msg, "*"); } catch (e) {}
  }

  function report() {
    send({ type: "find-result", total: marks.length, index: cur, query: query });
  }

  function clear() {
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], p = m.parentNode;
      if (!p) continue;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
    marks = [];
    cur = -1;
  }

  function collect(qLower) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var v = node.nodeValue;
        if (!v) return NodeFilter.FILTER_REJECT;
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var t = p.nodeName;
        if (t === "SCRIPT" || t === "STYLE" || t === "NOSCRIPT" || t === "TEXTAREA")
          return NodeFilter.FILTER_REJECT;
        if (p.nodeType === 1 && !isVisible(p)) return NodeFilter.FILTER_REJECT;
        return v.toLowerCase().indexOf(qLower) >= 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });
    var out = [];
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function isVisible(el) {
    if (el.offsetParent !== null) return true;
    var s = el.ownerDocument.defaultView.getComputedStyle(el);
    return s && s.display !== "none" && s.visibility !== "hidden";
  }

  function markNode(node, qLower, qLen) {
    var text = node.nodeValue, lower = text.toLowerCase();
    var frag = document.createDocumentFragment();
    var pos = 0, idx = lower.indexOf(qLower);
    while (idx >= 0) {
      if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
      var m = document.createElement("mark");
      m.className = MARK;
      m.textContent = text.slice(idx, idx + qLen);
      frag.appendChild(m);
      marks.push(m);
      pos = idx + qLen;
      idx = lower.indexOf(qLower, pos);
    }
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    node.parentNode.replaceChild(frag, node);
  }

  function setCurrent(i, scroll) {
    if (cur >= 0 && marks[cur]) marks[cur].classList.remove(CURRENT);
    cur = i;
    var m = marks[cur];
    if (m) {
      m.classList.add(CURRENT);
      if (scroll && m.scrollIntoView) m.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }

  function run(q) {
    clear();
    query = q || "";
    if (!document.body || !query) { report(); return; }
    ensureStyle();
    var qLower = query.toLowerCase();
    var nodes = collect(qLower);
    for (var i = 0; i < nodes.length; i++) markNode(nodes[i], qLower, query.length);
    if (marks.length) setCurrent(0, true);
    report();
  }

  function step(delta) {
    if (!marks.length) return;
    setCurrent((cur + delta + marks.length) % marks.length, true);
    report();
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.__artiview !== true) return;
    if (d.type === "find") run(d.query);
    else if (d.type === "find-step") step(d.delta || 1);
    else if (d.type === "find-clear") { clear(); query = ""; report(); }
    else if (d.type === "find-ping") report();
  });

  window.addEventListener("keydown", function (e) {
    var k = (e.key || "").toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "f") { e.preventDefault(); send({ type: "find-open" }); }
    else if (k === "escape") send({ type: "find-escape" });
  });

  send({ type: "find-ready" });
})();
`;

const SCRIPT_TAG = `<script>${FIND_SCRIPT}</script>`;

/** Inject the find script into a full HTML document we generated ourselves. */
export function injectFindScript(htmlDoc: string): string {
  return /<\/body>/i.test(htmlDoc)
    ? htmlDoc.replace(/<\/body>/i, `${SCRIPT_TAG}</body>`)
    : htmlDoc + SCRIPT_TAG;
}

/**
 * Prepare an arbitrary HTML file for the viewer: add a `<base>` so relative
 * resources resolve exactly like the current asset-URL document does, then
 * inject the find script. `baseHref` should be the file's own asset URL.
 */
export function wrapHtmlForViewer(rawHtml: string, baseHref: string): string {
  let out = rawHtml;

  // Only set a base when the document doesn't define its own, so we never
  // override an author's intended <base>.
  if (!/<base[\s/>]/i.test(out)) {
    const baseTag = `<base href="${baseHref.replace(/"/g, "&quot;")}">`;
    if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + baseTag);
    else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${baseTag}</head>`);
    else out = baseTag + out;
  }

  return injectFindScript(out);
}
