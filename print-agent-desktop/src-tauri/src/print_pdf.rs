use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use crate::printers::list_installed_printers;
use crate::test_pdf::build_test_pdf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintResult {
    pub printer_name: String,
    pub pdf_path: String,
}

pub fn print_test_pdf(directory: &std::path::Path, printer_name: &str) -> Result<PrintResult, String> {
    let printer_name = printer_name.trim();
    if printer_name.is_empty() {
        return Err("Choose a printer first.".into());
    }
    let printers = list_installed_printers()?;
    if !printers.iter().any(|printer| printer.name == printer_name) {
        return Err("That printer is not installed in Windows.".into());
    }

    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let pdf_path = directory.join("postbus-test-label.pdf");
    fs::write(&pdf_path, build_test_pdf()).map_err(|error| error.to_string())?;
    let bitmap = render_pdf_page(&pdf_path, 0)?;
    submit_bitmap_to_driver(&bitmap, printer_name, 4.0, 6.0, 1)?;
    Ok(PrintResult {
        printer_name: printer_name.to_string(),
        pdf_path: pdf_path.display().to_string(),
    })
}

struct PageBitmap {
    width: i32,
    height: i32,
    /// Top-down BGRA pixels.
    pixels: Vec<u8>,
}

pub fn print_label_pdf(pdf_path: &std::path::Path, printer_name: &str, paper_size: &str, copies: u32) -> Result<(), String> {
    let printer_name = printer_name.trim();
    if printer_name.is_empty() {
        return Err("Choose a printer first.".into());
    }
    let printers = list_installed_printers()?;
    if !printers.iter().any(|printer| printer.name == printer_name) {
        return Err("That printer is not installed in Windows.".into());
    }
    let path = pdf_path.to_path_buf();
    let pages = pdf_page_count(&path)?;
    if pages == 0 {
        return Err("The label PDF has no pages.".into());
    }
    let (width_in, height_in) = paper_inches(paper_size);
    let copies = copies.max(1);
    for index in 0..pages {
        let bitmap = render_pdf_page(&path, index)?;
        submit_bitmap_to_driver(&bitmap, printer_name, width_in, height_in, copies)?;
    }
    Ok(())
}

fn paper_inches(paper_size: &str) -> (f32, f32) {
    match paper_size.trim().to_ascii_uppercase().as_str() {
        "4X6" => (4.0, 6.0),
        "A5" => (5.83, 8.27),
        "A4" => (8.27, 11.69),
        "A3" => (11.69, 16.54),
        _ => (4.13, 5.83),
    }
}

fn pdf_page_count(pdf_path: &PathBuf) -> Result<u32, String> {
    use windows::Data::Pdf::PdfDocument;
    use windows::Storage::StorageFile;
    use windows::core::HSTRING;
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
    use windows::Data::Pdf::PdfDocument;
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
    use windows::core::HSTRING;

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
    let stream = InMemoryRandomAccessStream::new().map_err(|error| error.to_string())?;
    page.RenderToStreamAsync(&stream)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let _ = page.Close();
    let size = stream.Size().map_err(|error| error.to_string())? as usize;
    stream.Seek(0).map_err(|error| error.to_string())?;
    let input = stream.GetInputStreamAt(0).map_err(|error| error.to_string())?;
    let reader = DataReader::CreateDataReader(&input).map_err(|error| error.to_string())?;
    reader
        .LoadAsync(size as u32)
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|error| error.to_string())?;
    let mut encoded = vec![0u8; size];
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
    Err("Windows did not return a bitmap for the test PDF.".into())
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
        _ => return Err("The rendered test page used an unsupported image format.".into()),
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
        pixels.copy_from_slice(&pixels_src[..pixel_len]);
    } else {
        for row in 0..height as usize {
            let src = (height as usize - 1 - row) * row_bytes;
            let dest = row * row_bytes;
            pixels[dest..dest + row_bytes].copy_from_slice(&pixels_src[src..src + row_bytes]);
        }
    }
    Ok(PageBitmap { width, height, pixels })
}

fn submit_bitmap_to_driver(bitmap: &PageBitmap, printer_name: &str, width_in: f32, height_in: f32, copies: u32) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateDCW, DeleteDC, GetDeviceCaps, StretchDIBits, BITMAPINFO, DIB_RGB_COLORS, LOGPIXELSX,
        LOGPIXELSY, SRCCOPY,
    };
    use windows_sys::Win32::Storage::Xps::{EndDoc, EndPage, StartDocW, StartPage, DOCINFOW};

    let driver = wide("WINSPOOL");
    let device = wide(printer_name);
    let document = wide("PostBus shipping label");
    unsafe {
        let dc = CreateDCW(driver.as_ptr(), device.as_ptr(), ptr::null(), ptr::null());
        if dc.is_null() {
            return Err("Windows could not open the selected printer driver.".into());
        }
        let mut info: DOCINFOW = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<DOCINFOW>() as i32;
        info.lpszDocName = document.as_ptr();
        let job = StartDocW(dc, &info);
        if job <= 0 {
            DeleteDC(dc);
            return Err("Windows did not accept the test page for that printer.".into());
        }
        let dpi_x = GetDeviceCaps(dc, LOGPIXELSX as i32).max(96);
        let dpi_y = GetDeviceCaps(dc, LOGPIXELSY as i32).max(96);
        let dest_w = (width_in * dpi_x as f32).round() as i32;
        let dest_h = (height_in * dpi_y as f32).round() as i32;
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
                return Err("Windows did not start a page on that printer.".into());
            }
            let drawn = StretchDIBits(
                dc,
                0,
                0,
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
                return Err("Windows could not draw the label PDF on the selected printer driver.".into());
            }
        }
        let doc_ok = EndDoc(dc) > 0;
        DeleteDC(dc);
        if !doc_ok {
            return Err("Windows could not finish the print job.".into());
        }
        Ok(())
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
