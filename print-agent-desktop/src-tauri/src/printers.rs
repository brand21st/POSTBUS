use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub local_id: String,
    pub name: String,
    pub port: String,
    pub connection_type: ConnectionType,
    pub status: PrinterStatus,
    pub is_default: bool,
    /// Windows does not tell us whether the driver accepts PDF bytes.
    pub supports_pdf: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ConnectionType {
    USB,
    NETWORK,
    UNKNOWN,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PrinterStatus {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "offline")]
    Offline,
    UNKNOWN,
}

pub fn classify_port(port: &str) -> ConnectionType {
    let port = port.trim().to_ascii_uppercase();
    if port.is_empty() {
        return ConnectionType::UNKNOWN;
    }
    if port.contains("USB") {
        return ConnectionType::USB;
    }
    if port.starts_with("IP_")
        || port.starts_with("\\\\")
        || port.contains("WSD")
        || port.contains("TCP")
        || port.starts_with("HTTP")
    {
        return ConnectionType::NETWORK;
    }
    ConnectionType::UNKNOWN
}

pub fn classify_status(status_bits: u32, attributes: u32) -> PrinterStatus {
    const OFFLINE: u32 = 0x0000_0080;
    const WORK_OFFLINE: u32 = 0x0000_0400;
    if status_bits & OFFLINE != 0 || attributes & WORK_OFFLINE != 0 {
        return PrinterStatus::Offline;
    }
    if status_bits == 0 {
        return PrinterStatus::Ready;
    }
    PrinterStatus::UNKNOWN
}

pub fn is_windows_default(attributes: u32) -> bool {
    const DEFAULT: u32 = 0x0000_0004;
    attributes & DEFAULT != 0
}

pub fn local_id(name: &str, port: &str) -> String {
    format!("{port}|{name}")
}

pub fn normalize(name: &str, port: &str, status_bits: u32, attributes: u32) -> Option<PrinterInfo> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let port = port.trim();
    Some(PrinterInfo {
        local_id: local_id(name, port),
        connection_type: classify_port(port),
        status: classify_status(status_bits, attributes),
        is_default: is_windows_default(attributes),
        supports_pdf: None,
        name: name.to_string(),
        port: port.to_string(),
    })
}

#[derive(Debug)]
pub enum EnumProbe {
    Empty,
    Buffer,
}

const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

pub fn interpret_enum_printers_probe(ok: i32, needed: u32, last_error: u32) -> Result<EnumProbe, String> {
    if needed > 0 {
        return Ok(EnumProbe::Buffer);
    }
    if ok == 0 && last_error != 0 && last_error != ERROR_INSUFFICIENT_BUFFER {
        return Err(format!(
            "Windows could not list installed printers (error {last_error})."
        ));
    }
    Ok(EnumProbe::Empty)
}

pub fn resolve_printer<'a>(
    printers: &'a [PrinterInfo],
    printer_name: &str,
    preferred_local_id: Option<&str>,
) -> Result<&'a PrinterInfo, String> {
    let name = printer_name.trim();
    if name.is_empty() {
        return Err("Choose a printer first.".into());
    }
    let matches: Vec<&'a PrinterInfo> = printers.iter().filter(|printer| printer.name == name).collect();
    if matches.is_empty() {
        return Err("That printer is not installed in Windows.".into());
    }
    let chosen = if let Some(local_id) = preferred_local_id.map(str::trim).filter(|value| !value.is_empty()) {
        matches
            .iter()
            .copied()
            .find(|printer| printer.local_id == local_id)
            .or_else(|| if matches.len() == 1 { Some(matches[0]) } else { None })
    } else if matches.len() == 1 {
        Some(matches[0])
    } else {
        None
    };
    let Some(printer) = chosen else {
        return Err(
            "Multiple Windows printers share that name. Select the printer again in the Print Agent.".into(),
        );
    };
    if printer.status == PrinterStatus::Offline {
        return Err("The selected printer is offline or unavailable.".into());
    }
    Ok(printer)
}

#[allow(dead_code)]
pub fn saved_selection<'a>(
    printers: &'a [PrinterInfo],
    saved_name: Option<&str>,
    saved_local_id: Option<&str>,
) -> Option<&'a PrinterInfo> {
    if let Some(local_id) = saved_local_id.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(printer) = printers.iter().find(|printer| printer.local_id == local_id) {
            return Some(printer);
        }
    }
    let name = saved_name.map(str::trim).filter(|value| !value.is_empty())?;
    let matches: Vec<&'a PrinterInfo> = printers.iter().filter(|printer| printer.name == name).collect();
    if matches.len() == 1 {
        Some(matches[0])
    } else {
        None
    }
}

#[cfg(windows)]
pub fn list_installed_printers() -> Result<Vec<PrinterInfo>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };

    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed = 0u32;
        let mut returned = 0u32;
        let probe = EnumPrintersW(
            flags,
            ptr::null(),
            2,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
        let last_error = GetLastError();
        match interpret_enum_printers_probe(probe, needed, last_error)? {
            EnumProbe::Empty => return Ok(Vec::new()),
            EnumProbe::Buffer => {}
        }
        let mut buffer = vec![0u8; needed as usize];
        let mut ok = EnumPrintersW(
            flags,
            ptr::null(),
            2,
            buffer.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        );
        if ok == 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER {
            buffer.resize(needed as usize, 0);
            ok = EnumPrintersW(
                flags,
                ptr::null(),
                2,
                buffer.as_mut_ptr(),
                needed,
                &mut needed,
                &mut returned,
            );
        }
        if ok == 0 {
            return Err(format!(
                "Windows could not list installed printers (error {}).",
                GetLastError()
            ));
        }
        let rows = std::slice::from_raw_parts(
            buffer.as_ptr() as *const PRINTER_INFO_2W,
            returned as usize,
        );
        let mut printers = Vec::with_capacity(rows.len());
        for row in rows {
            let name = wide_to_string(row.pPrinterName);
            let port = wide_to_string(row.pPortName);
            if let Some(printer) = normalize(&name, &port, row.Status, row.Attributes) {
                printers.push(printer);
            }
        }
        printers.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        Ok(printers)
    }
}

#[cfg(not(windows))]
pub fn list_installed_printers() -> Result<Vec<PrinterInfo>, String> {
    Err("Printer discovery is implemented for Windows only.".into())
}

#[cfg(windows)]
fn wide_to_string(ptr: *mut u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe {
        let mut len = 0usize;
        while *ptr.add(len) != 0 {
            len += 1;
            if len > 1024 {
                break;
            }
        }
        String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_port, classify_status, interpret_enum_printers_probe, normalize, resolve_printer,
        saved_selection, ConnectionType, EnumProbe, PrinterStatus,
    };

    #[test]
    fn usb_ports_are_marked_usb() {
        assert_eq!(classify_port("USB001"), ConnectionType::USB);
        assert_eq!(classify_port(" usb002 "), ConnectionType::USB);
    }

    #[test]
    fn network_ports_are_marked_network() {
        assert_eq!(classify_port("IP_192.168.1.20"), ConnectionType::NETWORK);
        assert_eq!(classify_port("\\\\server\\printer"), ConnectionType::NETWORK);
        assert_eq!(classify_port("WSD-123"), ConnectionType::NETWORK);
    }

    #[test]
    fn unknown_ports_stay_unknown() {
        assert_eq!(classify_port(""), ConnectionType::UNKNOWN);
        assert_eq!(classify_port("LPT1:"), ConnectionType::UNKNOWN);
    }

    #[test]
    fn idle_spooler_status_is_ready_and_other_bits_stay_unknown() {
        assert_eq!(classify_status(0, 0), PrinterStatus::Ready);
        assert_eq!(classify_status(0x80, 0), PrinterStatus::Offline);
        assert_eq!(classify_status(0, 0x400), PrinterStatus::Offline);
        assert_eq!(classify_status(0x2, 0), PrinterStatus::UNKNOWN);
    }

    #[test]
    fn enum_probe_empty_list_is_ok_when_windows_reports_no_buffer() {
        assert!(matches!(interpret_enum_printers_probe(0, 0, 122).unwrap(), EnumProbe::Empty));
        assert!(matches!(interpret_enum_printers_probe(1, 0, 0).unwrap(), EnumProbe::Empty));
    }

    #[test]
    fn enum_probe_reports_windows_error_when_listing_fails() {
        let error = interpret_enum_printers_probe(0, 0, 5).unwrap_err();
        assert!(error.contains("error 5"));
    }

    #[test]
    fn resolve_printer_requires_exact_name_and_local_id_on_collision() {
        let left = normalize("Zebra", "USB001", 0, 0).unwrap();
        let right = normalize("Zebra", "USB002", 0, 0).unwrap();
        let printers = vec![left.clone(), right.clone()];
        assert_eq!(
            resolve_printer(&printers, "Zebra", Some(&left.local_id))
                .unwrap()
                .local_id,
            left.local_id
        );
        let missing = resolve_printer(&printers, "Missing", None).unwrap_err();
        assert!(missing.contains("not installed"));
        let collision = resolve_printer(&printers, "Zebra", None).unwrap_err();
        assert!(collision.contains("Multiple Windows printers"));
        let offline = normalize("Zebra", "USB001", 0x80, 0).unwrap();
        assert!(resolve_printer(&[offline], "Zebra", None)
            .unwrap_err()
            .contains("offline"));
    }

    #[test]
    fn saved_selection_does_not_fall_back_to_another_queue() {
        let zebra = normalize("Zebra", "USB001", 0, 0).unwrap();
        let epson = normalize("Epson", "USB002", 0, 0x4).unwrap();
        let printers = vec![zebra.clone(), epson];
        assert!(saved_selection(&printers, Some("Gone"), None).is_none());
        assert_eq!(
            saved_selection(&printers, Some("Zebra"), Some(&zebra.local_id))
                .unwrap()
                .name,
            "Zebra"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_returns_installed_queues_without_invented_pdf_support() {
        let printers = super::list_installed_printers().expect("windows printer enumeration");
        for printer in &printers {
            assert!(!printer.name.trim().is_empty());
            assert!(printer.supports_pdf.is_none());
            assert!(matches!(
                printer.connection_type,
                ConnectionType::USB | ConnectionType::NETWORK | ConnectionType::UNKNOWN
            ));
        }
    }

    #[test]
    fn empty_names_are_dropped_and_pdf_support_is_not_invented() {
        assert!(normalize("  ", "USB001", 0, 0).is_none());
        let printer = normalize("Zebra", "USB001", 0, 0x4).unwrap();
        assert!(printer.is_default);
        assert_eq!(printer.connection_type, ConnectionType::USB);
        assert_eq!(printer.supports_pdf, None);
        assert_eq!(printer.local_id, "USB001|Zebra");
        assert_eq!(printer.port, "USB001");
    }
}
