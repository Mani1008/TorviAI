use tauri::{AppHandle, Manager};
use xcap::Monitor;
use base64::{engine::general_purpose, Engine as _};
use std::io::Cursor;

/// Capture the primary screen and return as a base64-encoded PNG string.
#[tauri::command]
pub async fn start_screen_capture(_app: AppHandle) -> Result<String, String> {
    let monitors = Monitor::all().map_err(|e| format!("Monitor error: {e}"))?;
    let monitor = monitors.into_iter().next().ok_or("No monitors found")?;
    let image = monitor.capture_image().map_err(|e| format!("Capture error: {e}"))?;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode error: {e}"))?;
    let b64 = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Convert a captured screenshot to base64.
///
/// TODO: Encode captured image to base64 PNG.
#[tauri::command]
pub async fn capture_to_base64(monitor_index: usize) -> Result<String, String> {
    println!("[Capture] capture_to_base64: monitor={}", monitor_index);
    Ok("data:image/png;base64,placeholder".to_string())
}

/// Crop a selected area from a captured monitor.
///
/// TODO: Use image crate for cropping.
/// TODO: Handle DPI scale factor.
#[tauri::command]
pub async fn capture_selected_area(
    monitor_index: usize,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    println!(
        "[Capture] capture_selected_area: monitor={}, region=({},{},{},{})",
        monitor_index, x, y, width, height
    );
    Ok("data:image/png;base64,placeholder".to_string())
}

/// Close an overlay window after screenshot selection.
#[tauri::command]
pub async fn close_overlay_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
