use tauri::{AppHandle, Manager};

/// Start screen capture on all monitors, open overlay windows.
///
/// TODO: Capture all monitors using xcap.
/// TODO: Create overlay windows per monitor.
/// TODO: Handle DPI scaling.
#[tauri::command]
pub async fn start_screen_capture(_app: AppHandle) -> Result<(), String> {
    println!("[Capture] start_screen_capture");
    // Placeholder - will use xcap crate
    Ok(())
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
