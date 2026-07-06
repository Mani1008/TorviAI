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

/// Capture a specific monitor by index and return a base64-encoded PNG data URL.
/// Applies the same rate-limit as `start_screen_capture` (max 2 fps).
#[tauri::command]
pub async fn capture_to_base64(
    monitor_index: usize,
    cooldown: State<'_, CaptureCooldown>,
) -> Result<String, String> {
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
    let monitor = monitors
        .into_iter()
        .nth(monitor_index)
        .ok_or_else(|| format!("Monitor index {monitor_index} not found"))?;
    let image = monitor.capture_image().map_err(|e| format!("Capture error: {e}"))?;
    let mut buf = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode error: {e}"))?;
    let b64 = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Capture a region of a specific monitor and return it as a base64-encoded PNG data URL.
///
/// `x`, `y`, `width`, `height` are in **logical (CSS) pixels** as reported by the browser.
/// The function derives the DPI scale factor from the ratio of the captured image's physical
/// dimensions to the monitor's reported logical dimensions, then converts the crop rect to
/// physical pixels before cropping. Coordinates are clamped to image bounds.
#[tauri::command]
pub async fn capture_selected_area(
    monitor_index: usize,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    cooldown: State<'_, CaptureCooldown>,
) -> Result<String, String> {
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
    let monitor = monitors
        .into_iter()
        .nth(monitor_index)
        .ok_or_else(|| format!("Monitor index {monitor_index} not found"))?;

    // Capture the full monitor at physical resolution.
    let img = monitor.capture_image().map_err(|e| format!("Capture error: {e}"))?;
    let phys_w = img.width();
    let phys_h = img.height();

    // Derive DPI scale factor: physical / logical.
    // xcap's Monitor::width()/height() return logical pixel dimensions.
    let logical_w = monitor.width() as f64;
    let scale = if logical_w > 0.0 {
        phys_w as f64 / logical_w
    } else {
        1.0
    };

    // Convert logical coords to physical, then clamp to image bounds.
    let px = ((x as f64 * scale).round() as u32).min(phys_w.saturating_sub(1));
    let py = ((y as f64 * scale).round() as u32).min(phys_h.saturating_sub(1));
    let pw = ((width as f64 * scale).round() as u32).min(phys_w - px);
    let ph = ((height as f64 * scale).round() as u32).min(phys_h - py);

    if pw == 0 || ph == 0 {
        return Err("Selected area is zero-sized after DPI scaling — check coordinates.".to_string());
    }

    let cropped = image::DynamicImage::ImageRgba8(img).crop_imm(px, py, pw, ph);
    let mut buf = Cursor::new(Vec::new());
    cropped
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("PNG encode error: {e}"))?;
    let b64 = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Close an overlay window after screenshot selection.
#[tauri::command]
pub async fn close_overlay_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
