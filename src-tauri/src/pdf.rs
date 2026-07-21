//! PDF metadata + text extraction for the search index, via lopdf.
//!
//! PDFs are indexed like HTML/Markdown: a display title (from the document's
//! Info dictionary) and a capped plain-text body for full-text search.
//! Rendering is done natively by the webview — this module only feeds the index.

use crate::html::{cap_body, collapse_ws, Meta, MAX_BODY_CHARS};
use lopdf::{Document, Object};

/// Local PDFs larger than this skip content extraction (metadata-only index):
/// unlike HTML/Markdown reports, PDFs can be huge, and extraction requires
/// pulling the whole file into memory on every scan.
pub const MAX_EXTRACT_BYTES: i64 = 50 * 1024 * 1024;

/// Per-page decompressed-content cap — a small compressed stream must not be
/// able to balloon a scan (decompression bomb in an untrusted file).
const MAX_PAGE_DECOMPRESSED: usize = 8 * 1024 * 1024;

/// Max pages fed to text extraction. MAX_BODY_CHARS caps the indexed body
/// anyway, so later pages of a huge document would be dropped regardless.
const MAX_PAGES: usize = 300;

pub fn extract(raw: &[u8]) -> Meta {
    // lopdf parses fully untrusted input; a panic on a malformed file must
    // degrade to "no metadata", not take down the whole scan.
    std::panic::catch_unwind(|| extract_inner(raw)).unwrap_or_default()
}

fn extract_inner(raw: &[u8]) -> Meta {
    let Ok(doc) = Document::load_mem(raw) else {
        return Meta::default();
    };
    // Encrypted documents: even "empty password" ones tend to yield garbage
    // through the text extractor, so index by filename only.
    if doc.is_encrypted() {
        return Meta::default();
    }

    let title = info_title(&doc);

    let pages: Vec<u32> = doc.get_pages().keys().copied().take(MAX_PAGES).collect();
    let mut body = String::new();
    for chunk in doc.extract_text_chunks_with_limit(&pages, MAX_PAGE_DECOMPRESSED) {
        // Unreadable fragments (exotic encodings, broken streams) are skipped;
        // whatever did decode still makes the file findable.
        if let Ok(t) = chunk {
            body.push_str(&t);
            body.push(' ');
            if body.len() > MAX_BODY_CHARS * 4 {
                break; // bytes ≥ chars, so this is already past the index cap
            }
        }
    }
    Meta {
        title,
        heading: None,
        body: cap_body(collapse_ws(&body)),
    }
}

/// `/Title` from the trailer's Info dictionary, decoded per PDF string rules.
fn info_title(doc: &Document) -> Option<String> {
    let info = match doc.trailer.get(b"Info").ok()? {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        o => o,
    };
    let bytes = match info.as_dict().ok()?.get(b"Title").ok()? {
        Object::Reference(id) => doc.get_object(*id).ok()?.as_str().ok()?,
        o => o.as_str().ok()?,
    };
    let s = collapse_ws(&decode_pdf_string(bytes));
    (!s.is_empty()).then_some(s)
}

/// PDF text strings are UTF-16BE (BOM FE FF) or UTF-8 (BOM EF BB BF, PDF 2.0);
/// anything else is PDFDocEncoding, whose printable range matches Latin-1
/// closely enough for a display title.
fn decode_pdf_string(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units = rest
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]));
        char::decode_utf16(units)
            .map(|r| r.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect()
    } else if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(rest).into_owned()
    } else {
        bytes.iter().map(|&b| b as char).collect()
    }
}

// ---- tests ------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Stream};

    /// Build a minimal one-page PDF with a Title and one text run.
    fn sample_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 24.into()]),
                Operation::new("Td", vec![100.into(), 600.into()]),
                Operation::new("Tj", vec![Object::string_literal("Quarterly latency report")]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().expect("encode content"),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        let info_id = doc.add_object(dictionary! {
            "Title" => Object::string_literal("Perf Deep Dive"),
        });
        doc.trailer.set("Info", info_id);

        let mut out = Vec::new();
        doc.save_to(&mut out).expect("save pdf");
        out
    }

    #[test]
    fn extracts_title_and_body() {
        let m = extract(&sample_pdf());
        assert_eq!(m.title.as_deref(), Some("Perf Deep Dive"));
        assert!(m.body.contains("Quarterly latency report"), "body: {}", m.body);
    }

    #[test]
    fn garbage_input_degrades_gracefully() {
        let m = extract(b"%PDF-1.7 this is not really a pdf");
        assert_eq!(m.title, None);
        assert_eq!(m.body, "");
        let m = extract(&[]);
        assert_eq!(m.title, None);
    }

    #[test]
    fn decodes_utf16_titles() {
        assert_eq!(
            decode_pdf_string(&[0xFE, 0xFF, 0xD5, 0x5C, 0xAC, 0x00]),
            "한가"
        );
        assert_eq!(decode_pdf_string(b"plain"), "plain");
    }
}
