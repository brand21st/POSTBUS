use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use crate::printers::{list_installed_printers, resolve_printer};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintResult {
    pub printer_name: String,
    pub pdf_path: String,
    pub spooler_job_id: i32,
}

pub fn is_print_error_retryable(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not installed") {
        return false;
    }
    ["offline", "unavailable", "could not open"]
        .iter()
        .any(|part| lower.contains(part))
}

pub fn paper_inches(paper_size: &str) -> Result<(f32, f32), String> {
    match paper_size.trim().to_ascii_uppercase().replace('×', "X").as_str() {
        "4X6" => Ok((4.0, 6.0)),
        "A6" => Ok((4.13, 5.83)),
        "A5" => Ok((5.83, 8.27)),
        "A4" => Ok((8.27, 11.69)),
        "A3" => Ok((11.69, 16.54)),
        other => Err(format!(
            "Unknown paper size '{other}'. Use A3, A4, A5, A6, or 4x6."
        )),
    }
}

pub fn apply_orientation(width_in: f32, height_in: f32, orientation: Option<&str>) -> (f32, f32) {
    let landscape = orientation
        .unwrap_or("portrait")
        .eq_ignore_ascii_case("landscape");
    if landscape {
        (width_in.max(height_in), width_in.min(height_in))
    } else {
        (width_in.min(height_in), width_in.max(height_in))
    }
}

pub fn fit_dest_rect(src_w: i32, src_h: i32, area_w: i32, area_h: i32) -> (i32, i32, i32, i32) {
    if src_w <= 0 || src_h <= 0 || area_w <= 0 || area_h <= 0 {
        return (0, 0, area_w.max(1), area_h.max(1));
    }
    let scale = (area_w as f32 / src_w as f32).min(area_h as f32 / src_h as f32);
    let width = (src_w as f32 * scale).round().max(1.0) as i32;
    let height = (src_h as f32 * scale).round().max(1.0) as i32;
    let x = (area_w - width) / 2;
    let y = (area_h - height) / 2;
    (x, y, width, height)
}

pub fn print_test_pdf(
    directory: &std::path::Path,
    printer_name: &str,
    preferred_local_id: Option<&str>,
) -> Result<PrintResult, String> {
    let printers = list_installed_printers()?;
    let printer = resolve_printer(&printers, printer_name, preferred_local_id)?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let pdf_path = directory.join("postbus-test-label.pdf");
    fs::write(&pdf_path, crate::test_pdf::build_test_pdf()).map_err(|error| error.to_string())?;
    let bitmap = render_pdf_page(&pdf_path, 0)?;
    let spooler_job_id = submit_bitmap_to_driver(&bitmap, &printer.name, 4.0, 6.0, 1, Some("portrait"))?;
    Ok(PrintResult {
        printer_name: printer.name.clone(),
        pdf_path: pdf_path.display().to_string(),
        spooler_job_id,
    })
}

struct PageBitmap {
    width: i32,
    height: i32,
    /// Top-down BGRA pixels.
    pixels: Vec<u8>,
}

pub fn print_label_pdf(
    pdf_path: &std::path::Path,
    printer_name: &str,
    paper_size: &str,
    copies: u32,
    orientation: Option<&str>,
    preferred_local_id: Option<&str>,
) -> Result<i32, String> {
    let printers = list_installed_printers()?;
    let printer = resolve_printer(&printers, printer_name, preferred_local_id)?;
    let path = pdf_path.to_path_buf();
    let pages = pdf_page_count(&path)?;
    if pages == 0 {
        return Err("The label PDF has no pages.".into());
    }
    let paper = paper_inches(paper_size)?;
    let (width_in, height_in) = apply_orientation(paper.0, paper.1, orientation);
    let copies = copies.max(1);
    let mut last_job = 0;
    for index in 0..pages {
        let bitmap = render_pdf_page(&path, index)?;
        last_job = submit_bitmap_to_driver(&bitmap, &printer.name, width_in, height_in, copies, orientation)?;
    }
    Ok(last_job)
}

fn pdf_page_count(pdf_path: &PathBuf) -> Result<u32, String> {
    use windows::core::HSTRING;
    use windows::Data::Pdf::PdfDocument;
    use windows::Storage::StorageFile;
    let path = HSTRING::from(pdf_path.as_os_str().to_string_lossy().as_ref());
    let file = StorageFile::GetFileFromPathAsync(&path)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let document = PdfDocument::LoadFromFileAsync(&file)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    Ok(document.PageCount().map_err(|error| error.to_string())?)
}

fn render_pdf_page(pdf_path: &PathBuf, page_index: u32) -> Result<PageBitmap, String> {
    use windows::core::HSTRING;
    use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};

    let path = HSTRING::from(pdf_path.as_os_str().to_string_lossy().as_ref());
    let file = StorageFile::GetFileFromPathAsync(&path)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let document = PdfDocument::LoadFromFileAsync(&file)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    if page_index >= document.PageCount().map_err(|error| error.to_string())? {
        return Err("The label PDF has no pages.".into());
    }
    let page = document.GetPage(page_index).map_err(|error| error.to_string())?;
    let size = page.Size().map_err(|error| error.to_string())?;
    let dest_w = ((size.Width / 96.0) * 300.0).round().max(1.0) as u32;
    let dest_h = ((size.Height / 96.0) * 300.0).round().max(1.0) as u32;
    let options = PdfPageRenderOptions::new().map_err(|error| error.to_string())?;
    options.SetDestinationWidth(dest_w).map_err(|error| error.to_string())?;
    options.SetDestinationHeight(dest_h).map_err(|error| error.to_string())?;
    let stream = InMemoryRandomAccessStream::new().map_err(|error| error.to_string())?;
    page.RenderWithOptionsToStreamAsync(&stream, &options)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let _ = page.Close();
    let encoded_size = stream.Size().map_err(|error| error.to_string())? as usize;
    stream.Seek(0).map_err(|error| error.to_string())?;
    let input = stream.GetInputStreamAt(0).map_err(|error| error.to_string())?;
    let reader = DataReader::CreateDataReader(&input).map_err(|error| error.to_string())?;
    reader
        .LoadAsync(encoded_size as u32)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let mut encoded = vec![0u8; encoded_size];
    reader.ReadBytes(&mut encoded).map_err(|error| error.to_string())?;
    decode_page_image(&encoded)
}

fn decode_page_image(encoded: &[u8]) -> Result<PageBitmap, String> {
    if encoded.starts_with(b"\x89PNG") {
        return decode_png(encoded);
    }
    if encoded.starts_with(b"BM") {
        return decode_bmp(encoded);
    }
    Err("Windows did not return a bitmap for the label PDF.".into())
}

fn decode_png(encoded: &[u8]) -> Result<PageBitmap, String> {
    let decoder = png::Decoder::new(Cursor::new(encoded));
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).map_err(|error| error.to_string())?;
    let bytes = &buffer[..info.buffer_size()];
    let pixels = match info.color_type {
        png::ColorType::Rgba => rgba_to_bgra(bytes),
        png::ColorType::Rgb => rgb_to_bgra(bytes),
        _ => return Err("The rendered page used an unsupported image format.".into()),
    };
    Ok(PageBitmap {
        width: info.width as i32,
        height: info.height as i32,
        pixels,
    })
}

fn rgba_to_bgra(bytes: &[u8]) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(bytes.len());
    for chunk in bytes.chunks_exact(4) {
        pixels.extend_from_slice(&[chunk[2], chunk[1], chunk[0], chunk[3]]);
    }
    pixels
}

fn rgb_to_bgra(bytes: &[u8]) -> Vec<u8> {
    let mut pixels = Vec::with_capacity(bytes.len() / 3 * 4);
    for chunk in bytes.chunks_exact(3) {
        pixels.extend_from_slice(&[chunk[2], chunk[1], chunk[0], 255]);
    }
    pixels
}

fn decode_bmp(encoded: &[u8]) -> Result<PageBitmap, String> {
    if encoded.len() < 54 {
        return Err("Windows returned an incomplete bitmap.".into());
    }
    let offset = u32::from_le_bytes(encoded[10..14].try_into().unwrap()) as usize;
    let width = i32::from_le_bytes(encoded[18..22].try_into().unwrap());
    let height_raw = i32::from_le_bytes(encoded[22..26].try_into().unwrap());
    let bit_count = u16::from_le_bytes(encoded[28..30].try_into().unwrap());
    if width <= 0 || bit_count != 32 || offset >= encoded.len() {
        return Err("Windows returned a bitmap this build cannot send to the printer.".into());
    }
    let height = height_raw.unsigned_abs() as i32;
    let row_bytes = (width as usize) * 4;
    let pixels_src = &encoded[offset..];
    let pixel_len = row_bytes * height as usize;
    let mut pixels = vec![0u8; pixel_len];
    if height_raw < 0 {
        pixels.copy_from_slice(&pixels_src[..pixel_len.min(pixels_src.len())]);
    } else {
        for row in 0..height as usize {
            let src = (height as usize - 1 - row) * row_bytes;
            let dest = row * row_bytes;
            pixels[dest..dest + row_bytes].copy_from_slice(&pixels_src[src..src + row_bytes]);
        }
    }
    Ok(PageBitmap { width, height, pixels })
}

fn win32_error(action: &str) -> String {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::GetLastError;
        let code = unsafe { GetLastError() };
        return format!("{action} (Windows error {code}).");
    }
    #[cfg(not(windows))]
    {
        format!("{action}.")
    }
}

fn paper_constants(width_in: f32, height_in: f32) -> (i16, i16, i16) {
    let w = (width_in * 254.0).round() as i16;
    let h = (height_in * 254.0).round() as i16;
    let size = if (width_in - 8.27).abs() < 0.08 && (height_in - 11.69).abs() < 0.08 {
        9 // DMPAPER_A4
    } else if (width_in - 5.83).abs() < 0.08 && (height_in - 8.27).abs() < 0.08 {
        11 // DMPAPER_A5
    } else if (width_in - 4.13).abs() < 0.08 && (height_in - 5.83).abs() < 0.08 {
        70 // DMPAPER_A6
    } else if (width_in - 11.69).abs() < 0.08 && (height_in - 16.54).abs() < 0.08 {
        8 // DMPAPER_A3
    } else {
        256 // DMPAPER_USER
    };
    (size, w, h)
}

fn submit_bitmap_to_driver(
    bitmap: &PageBitmap,
    printer_name: &str,
    width_in: f32,
    height_in: f32,
    copies: u32,
    orientation: Option<&str>,
) -> Result<i32, String> {
    use std::ptr;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, GetDeviceCaps, StretchDIBits, BITMAPINFO, DEVMODEW, DIB_RGB_COLORS, DM_IN_BUFFER,
        DM_OUT_BUFFER, HORZRES, LOGPIXELSX, LOGPIXELSY, SRCCOPY, VERTRES,
    };
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, DocumentPropertiesW, GetJobW, OpenPrinterW, JOB_INFO_1W,
    };
    use windows_sys::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    const DM_ORIENTATION: u32 = 0x0000_0001;
    const DM_PAPERSIZE: u32 = 0x0000_0002;
    const DM_PAPERLENGTH: u32 = 0x0000_0004;
    const DM_PAPERWIDTH: u32 = 0x0000_0008;
    const DMORIENT_PORTRAIT: i16 = 1;
    const DMORIENT_LANDSCAPE: i16 = 2;
    const JOB_STATUS_ERROR: u32 = 0x0000_0002;
    const JOB_STATUS_OFFLINE: u32 = 0x0000_0020;
    const JOB_STATUS_PAPEROUT: u32 = 0x0000_0040;
    const JOB_STATUS_DELETED: u32 = 0x0000_0100;
    const JOB_STATUS_BLOCKED_DEVQ: u32 = 0x0000_0200;
    const JOB_STATUS_USER_INTERVENTION: u32 = 0x0000_0400;

    let driver = wide("WINSPOOL");
    let device = wide(printer_name);
    let document = wide("PostBus shipping label");
    let landscape = orientation
        .unwrap_or("portrait")
        .eq_ignore_ascii_case("landscape");
    let (paper_size, paper_w, paper_h) = paper_constants(width_in, height_in);

    unsafe {
        let mut printer_handle = ptr::null_mut();
        if OpenPrinterW(device.as_ptr() as *mut u16, &mut printer_handle, ptr::null()) == 0 {
            return Err(win32_error("Windows could not open the selected printer"));
        }

        let needed = DocumentPropertiesW(
            ptr::null_mut(),
            printer_handle,
            device.as_ptr() as *mut u16,
            ptr::null_mut(),
            ptr::null_mut(),
            0,
        );
        if needed <= 0 {
            ClosePrinter(printer_handle);
            return Err(win32_error("Windows could not read the printer paper settings"));
        }
        let mut devmode_bytes = vec![0u8; needed as usize];
        let devmode = devmode_bytes.as_mut_ptr() as *mut DEVMODEW;
        if DocumentPropertiesW(
            ptr::null_mut(),
            printer_handle,
            device.as_ptr() as *mut u16,
            devmode,
            ptr::null_mut(),
            DM_OUT_BUFFER,
        ) < 0
        {
            ClosePrinter(printer_handle);
            return Err(win32_error("Windows could not load the printer paper settings"));
        }
        (*devmode).dmFields |= DM_ORIENTATION | DM_PAPERSIZE | DM_PAPERLENGTH | DM_PAPERWIDTH;
        (*devmode).Anonymous1.Anonymous1.dmOrientation = if landscape {
            DMORIENT_LANDSCAPE
        } else {
            DMORIENT_PORTRAIT
        };
        (*devmode).Anonymous1.Anonymous1.dmPaperSize = paper_size;
        (*devmode).Anonymous1.Anonymous1.dmPaperWidth = paper_w;
        (*devmode).Anonymous1.Anonymous1.dmPaperLength = paper_h;
        if DocumentPropertiesW(
            ptr::null_mut(),
            printer_handle,
            device.as_ptr() as *mut u16,
            devmode,
            devmode,
            DM_IN_BUFFER | DM_OUT_BUFFER,
        ) < 0
        {
            ClosePrinter(printer_handle);
            return Err(win32_error(
                "The printer driver rejected the requested paper size",
            ));
        }

        let dc = CreateDCW(driver.as_ptr(), device.as_ptr(), ptr::null(), devmode);
        if dc.is_null() {
            ClosePrinter(printer_handle);
            return Err(win32_error("Windows could not open the selected printer driver"));
        }
        let mut info: DOCINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<DOCINFOW>() as i32;
        info.lpszDocName = document.as_ptr();
        let job = StartDocW(dc, &info);
        if job <= 0 {
            DeleteDC(dc);
            ClosePrinter(printer_handle);
            return Err(win32_error("Windows did not accept the page for that printer"));
        }
        let area_w = GetDeviceCaps(dc, HORZRES as i32).max(1);
        let area_h = GetDeviceCaps(dc, VERTRES as i32).max(1);
        let _dpi_x = GetDeviceCaps(dc, LOGPIXELSX as i32).max(96);
        let _dpi_y = GetDeviceCaps(dc, LOGPIXELSY as i32).max(96);
        let (dest_x, dest_y, dest_w, dest_h) = fit_dest_rect(bitmap.width, bitmap.height, area_w, area_h);
        let mut header: BITMAPINFO = std::mem::zeroed();
        header.bmiHeader.biSize = std::mem::size_of_val(&header.bmiHeader) as u32;
        header.bmiHeader.biWidth = bitmap.width;
        header.bmiHeader.biHeight = -bitmap.height;
        header.bmiHeader.biPlanes = 1;
        header.bmiHeader.biBitCount = 32;
        for _ in 0..copies.max(1) {
            if StartPage(dc) <= 0 {
                let _ = EndDoc(dc);
                DeleteDC(dc);
                ClosePrinter(printer_handle);
                return Err(win32_error("Windows did not start a page on that printer"));
            }
            let drawn = StretchDIBits(
                dc,
                dest_x,
                dest_y,
                dest_w,
                dest_h,
                0,
                0,
                bitmap.width,
                bitmap.height,
                bitmap.pixels.as_ptr().cast(),
                &header,
                DIB_RGB_COLORS,
                SRCCOPY,
            );
            let page_ok = EndPage(dc) > 0;
            if drawn == 0 || !page_ok {
                let _ = EndDoc(dc);
                DeleteDC(dc);
                ClosePrinter(printer_handle);
                return Err(win32_error(
                    "Windows could not draw the label PDF on the selected printer driver",
                ));
            }
        }
        let doc_ok = EndDoc(dc) > 0;
        DeleteDC(dc);
        if !doc_ok {
            ClosePrinter(printer_handle);
            return Err(win32_error("Windows could not finish the print job"));
        }

        let mut needed_job = 0u32;
        GetJobW(printer_handle, job as u32, 1, ptr::null_mut(), 0, &mut needed_job);
        if needed_job > 0 {
            let mut job_buf = vec![0u8; needed_job as usize];
            if GetJobW(
                printer_handle,
                job as u32,
                1,
                job_buf.as_mut_ptr(),
                needed_job,
                &mut needed_job,
            ) != 0
            {
                let info = &*(job_buf.as_ptr() as *const JOB_INFO_1W);
                let failed = info.Status
                    & (JOB_STATUS_ERROR
                        | JOB_STATUS_OFFLINE
                        | JOB_STATUS_PAPEROUT
                        | JOB_STATUS_DELETED
                        | JOB_STATUS_BLOCKED_DEVQ
                        | JOB_STATUS_USER_INTERVENTION);
                if failed != 0 {
                    ClosePrinter(printer_handle);
                    return Err(format!(
                        "Windows accepted the document but the spooler reported an error (status {}).",
                        info.Status
                    ));
                }
            }
        }
        ClosePrinter(printer_handle);
        Ok(job)
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::{apply_orientation, fit_dest_rect, is_print_error_retryable, paper_inches};

    #[test]
    fn named_paper_sizes_include_a6_and_reject_unknown() {
        assert_eq!(paper_inches("A6").unwrap(), (4.13, 5.83));
        assert_eq!(paper_inches("4x6").unwrap(), (4.0, 6.0));
        assert_eq!(paper_inches("A4").unwrap(), (8.27, 11.69));
        assert!(paper_inches("letter").unwrap_err().contains("Unknown paper size"));
    }

    #[test]
    fn landscape_swaps_to_wider_than_tall() {
        let (w, h) = apply_orientation(4.13, 5.83, Some("landscape"));
        assert!(w > h);
        let (pw, ph) = apply_orientation(8.27, 11.69, Some("portrait"));
        assert!(ph > pw);
    }

    #[test]
    fn fit_dest_rect_preserves_aspect_ratio() {
        let (x, y, w, h) = fit_dest_rect(400, 600, 800, 800);
        assert_eq!((w, h), (533, 800));
        assert_eq!(x, (800 - 533) / 2);
        assert_eq!(y, 0);
        let portrait = fit_dest_rect(600, 400, 800, 800);
        assert_eq!((portrait.2, portrait.3), (800, 533));
    }

    #[test]
    fn missing_printer_is_not_retryable() {
        assert!(!is_print_error_retryable("That printer is not installed in Windows."));
        assert!(is_print_error_retryable("The selected printer is offline or unavailable."));
        assert!(is_print_error_retryable("Windows could not open the selected printer (Windows error 5)."));
    }
}
