use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub local_id: String,
    pub name: String,
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
    Some(PrinterInfo {
        local_id: local_id(name, port.trim()),
        connection_type: classify_port(port),
        status: classify_status(status_bits, attributes),
        is_default: is_windows_default(attributes),
        supports_pdf: None,
        name: name.to_string(),
    })
}

#[cfg(windows)]
pub fn list_installed_printers() -> Result<Vec<PrinterInfo>, String> {
    use std::ptr;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };

    unsafe {
        let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let mut needed = 0u32;
        let mut returned = 0u32;
        EnumPrintersW(
            flags,
            ptr::null(),
            2,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
        if needed == 0 {
            return Ok(Vec::new());
        }
        let mut buffer = vec![0u8; needed as usize];
        let ok = EnumPrintersW(
            flags,
            ptr::null(),
            2,
            buffer.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        );
        if ok == 0 {
            return Err("Windows could not list installed printers.".into());
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
    use super::{classify_port, classify_status, normalize, ConnectionType, PrinterStatus};

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
    }
}
