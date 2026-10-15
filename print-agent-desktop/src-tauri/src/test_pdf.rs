/// One-page 4×6 inch test PDF. Helvetica only, so the file stays valid without embedded fonts.
pub fn build_test_pdf() -> Vec<u8> {
    let stream = "BT /F1 16 Tf 28 390 Td (PostBus Print Agent) Tj 0 -28 Td (Local test page) Tj 0 -22 Td (4 x 6 inch) Tj ET";
    let objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n".to_string(),
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n".to_string(),
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n".to_string(),
        format!(
            "4 0 obj << /Length {} >> stream\n{stream}\nendstream endobj\n",
            stream.len()
        ),
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n".to_string(),
    ];

    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for object in &objects {
        offsets.push(out.len());
        out.extend(object.as_bytes());
    }

    let xref_at = out.len();
    let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1);
    for offset in offsets {
        xref.push_str(&format!("{offset:010} 00000 n \n"));
    }
    out.extend(xref.as_bytes());
    out.extend(
        format!(
            "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    out
}

#[cfg(test)]
mod tests {
    use super::build_test_pdf;

    #[test]
    fn test_pdf_is_a_single_page_document() {
        let bytes = build_test_pdf();
        let text = String::from_utf8(bytes).expect("pdf is ascii");
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/MediaBox [0 0 288 432]"));
        assert!(text.contains("PostBus Print Agent"));
        assert!(text.trim_end().ends_with("%%EOF"));
    }
}
