//! Lightweight, dependency-free HTML text extraction.
//!
//! We only need three things out of each file for indexing:
//!   - the document <title>
//!   - the first heading (h1/h2/h3) as a fallback display name
//!   - a plain-text rendering of the body for full-text search
//!
//! This is deliberately not a real HTML parser — it is a forgiving scanner
//! that is good enough to feed an FTS index and pick out a title.

/// Max number of characters of body text we keep for the search index.
/// Generated reports can be huge; this keeps the DB and FTS reasonable.
/// (Shared with the PDF extractor, which feeds the same index.)
pub(crate) const MAX_BODY_CHARS: usize = 400_000;

#[derive(Default)]
pub struct Meta {
    pub title: Option<String>,
    pub heading: Option<String>,
    pub body: String,
}

/// Cap an already-collapsed body at MAX_BODY_CHARS.
pub(crate) fn cap_body(body: String) -> String {
    if body.chars().count() > MAX_BODY_CHARS {
        body.chars().take(MAX_BODY_CHARS).collect()
    } else {
        body
    }
}

pub fn extract(html: &str) -> Meta {
    Meta {
        title: tag_text(html, "title"),
        heading: ["h1", "h2", "h3"]
            .iter()
            .find_map(|t| tag_text(html, t)),
        body: strip(html),
    }
}

/// Extract a title + searchable body from Markdown source. The title is the
/// first ATX heading (`# ...`); the body is the raw text (capped), which is
/// good enough to feed the full-text index.
pub fn extract_md(src: &str) -> Meta {
    let title = src.lines().find_map(|line| {
        let t = line.trim_start();
        if t.starts_with('#') {
            let h = t.trim_start_matches('#').trim().trim_end_matches('#').trim();
            if !h.is_empty() {
                return Some(h.to_string());
            }
        }
        None
    });
    Meta {
        title,
        heading: None,
        body: cap_body(collapse_ws(src)),
    }
}

/// Extract a searchable body from plain text. No title/heading — the filename
/// is the only reliable display name a .txt gives us.
pub fn extract_txt(src: &str) -> Meta {
    Meta {
        title: None,
        heading: None,
        body: cap_body(collapse_ws(src)),
    }
}

/// Find `<tag ...>inner</tag>` (case-insensitive) and return the cleaned inner text.
fn tag_text(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut from = 0usize;
    while let Some(rel) = lower[from..].find(&open) {
        let start = from + rel;
        // make sure it's a real tag boundary (next char is space, >, or /)
        let after = lower.as_bytes().get(start + open.len()).copied();
        if !matches!(after, Some(b' ') | Some(b'>') | Some(b'\t') | Some(b'\n') | Some(b'/') | Some(b'\r')) {
            from = start + open.len();
            continue;
        }
        let Some(gt) = lower[start..].find('>') else { break };
        let inner_start = start + gt + 1;
        let Some(crel) = lower[inner_start..].find(&close) else { break };
        let inner = &html[inner_start..inner_start + crel];
        let text = clean(inner);
        if !text.is_empty() {
            return Some(text);
        }
        from = inner_start + crel + close.len();
    }
    None
}

/// Strip a full HTML document down to readable plain text.
fn strip(html: &str) -> String {
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut out = String::with_capacity(html.len() / 2);
    let mut i = 0usize;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'<' {
            // Skip <script>...</script> and <style>...</style> bodies entirely.
            if lower[i..].starts_with("<script") {
                i = skip_block(&lower, i, "</script>");
                out.push(' ');
                continue;
            }
            if lower[i..].starts_with("<style") {
                i = skip_block(&lower, i, "</style>");
                out.push(' ');
                continue;
            }
            if lower[i..].starts_with("<!--") {
                i = match lower[i..].find("-->") {
                    Some(rel) => i + rel + 3,
                    None => bytes.len(),
                };
                continue;
            }
            // Generic tag: skip to the matching '>'.
            match lower[i..].find('>') {
                Some(rel) => {
                    i += rel + 1;
                    out.push(' ');
                }
                None => break,
            }
        } else {
            // copy a run of text up to the next '<'
            let next = lower[i..].find('<').map(|r| i + r).unwrap_or(bytes.len());
            out.push_str(&html[i..next]);
            i = next;
        }
        if out.len() > MAX_BODY_CHARS * 2 {
            break;
        }
    }
    let decoded = decode_entities(&out);
    cap_body(collapse_ws(&decoded))
}

fn skip_block(lower: &str, start: usize, end_tag: &str) -> usize {
    match lower[start..].find(end_tag) {
        Some(rel) => start + rel + end_tag.len(),
        None => lower.len(),
    }
}

/// Clean a short snippet (title / heading): decode entities + collapse whitespace.
fn clean(s: &str) -> String {
    collapse_ws(&decode_entities(&strip_inline_tags(s)))
        .trim()
        .to_string()
}

/// Remove any nested tags from a snippet (e.g. `<span>` inside an `<h1>`).
fn strip_inline_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => {
                if depth > 0 {
                    depth -= 1;
                }
                out.push(' ');
            }
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
}

pub(crate) fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}
