use tauri::{AppHandle, Manager, State};
use xcap::Monitor;
use base64::{engine::general_purpose, Engine as _};
use std::io::Cursor;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// ─── Screenshot rate-limit state ─────────────────────────────────────────────

/// Tracks the timestamp of the last successful screen capture.
/// Enforces a minimum interval between captures to prevent memory exhaustion
/// via rapid IPC calls (a 4K capture is ~8 MB base64 over IPC per call).
pub struct CaptureCooldown(pub Mutex<Option<Instant>>);

impl Default for CaptureCooldown {
    fn default() -> Self {
        CaptureCooldown(Mutex::new(None))
    }
}

/// Minimum time between screen captures: 500 ms (max 2 fps).
const CAPTURE_COOLDOWN: Duration = Duration::from_millis(500);

/// Capture the primary screen and return as a base64-encoded PNG string.
#[tauri::command]
pub async fn start_screen_capture(
    _app: AppHandle,
    cooldown: State<'_, CaptureCooldown>,
) -> Result<String, String> {
    // Enforce cooldown — reject calls faster than 2 fps
    {
        let mut last = cooldown.0.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < CAPTURE_COOLDOWN {
                return Err("Capture cooldown active — please wait before capturing again.".to_string());
            }
        }
        *last = Some(Instant::now());
    }
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
/// TODO: Implement full monitor-index-based capture.
#[tauri::command]
pub async fn capture_to_base64(monitor_index: usize) -> Result<String, String> {
    let _ = monitor_index;
    Err("capture_to_base64 is not yet implemented".to_string())
}

/// Crop a selected area from a captured monitor.
///
/// TODO: Use image crate for cropping with DPI scale factor support.
#[tauri::command]
pub async fn capture_selected_area(
    monitor_index: usize,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let _ = (monitor_index, x, y, width, height);
    Err("capture_selected_area is not yet implemented".to_string())
}

/// Close an overlay window after screenshot selection.
#[tauri::command]
pub async fn close_overlay_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
