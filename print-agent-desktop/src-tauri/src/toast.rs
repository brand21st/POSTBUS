pub fn toast_for_claimed_job(printer: Option<&str>) -> (&'static str, String) {
    let title = "PostBus print job";
    let body = match printer.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => format!("Sending to {name}"),
        None => "Sending a shipping label to Windows".into(),
    };
    (title, body)
}

#[cfg(test)]
mod tests {
    use super::toast_for_claimed_job;

    #[test]
    fn names_the_windows_queue() {
        let (title, body) = toast_for_claimed_job(Some("HP LaserJet"));
        assert_eq!(title, "PostBus print job");
        assert_eq!(body, "Sending to HP LaserJet");
    }

    #[test]
    fn falls_back_when_the_queue_is_blank() {
        let (_, body) = toast_for_claimed_job(Some("  "));
        assert_eq!(body, "Sending a shipping label to Windows");
        let (_, empty) = toast_for_claimed_job(None);
        assert_eq!(empty, "Sending a shipping label to Windows");
    }
}
