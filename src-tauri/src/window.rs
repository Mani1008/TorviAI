use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow};

/// Apply Windows-specific style to hide window from taskbar Apps section.
/// Forces the window into Background Processes in Task Manager.
#[cfg(target_os = "windows")]
fn apply_background_process_style(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let hwnd_ptr = hwnd.0 as winapi::shared::windef::HWND;
            let ex_style = winapi::um::winuser::GetWindowLongPtrW(
                hwnd_ptr,
                winapi::um::winuser::GWL_EXSTYLE,
            );
            winapi::um::winuser::SetWindowLongPtrW(
                hwnd_ptr,
                winapi::um::winuser::GWL_EXSTYLE,
                (ex_style & !(winapi::um::winuser::WS_EX_APPWINDOW as isize))
                    | winapi::um::winuser::WS_EX_TOOLWINDOW as isize,
            );
        }
    }
}

/// Set up the main window position (top center of primary monitor).
pub fn setup_main_window(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let _ = window.set_size(LogicalSize::new(600.0, 600.0));

    if let Ok(monitor) = window.current_monitor() {
        if let Some(monitor) = monitor {
            let screen_size = monitor.size();
            let scale = monitor.scale_factor();
            let window_width_phys = (600.0 * scale) as i32;
            let x = (screen_size.width as i32 - window_width_phys) / 2;
            let y = (8.0 * scale) as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }

    let _ = window.show();

    // Hide from taskbar Apps section → move to Background Processes
    #[cfg(target_os = "windows")]
    apply_background_process_style(window);

    Ok(())
}

/// Dynamically set the window height (logical pixels, keeps width at 600).
#[tauri::command]
pub async fn set_window_height(window: WebviewWindow, height: f64) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(600.0, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the dashboard in a separate window.
#[tauri::command]
pub async fn open_dashboard(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("dashboard") {
        window.show().map_err(|e: tauri::Error| e.to_string())?;
        window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let url = WebviewUrl::App("/dashboard".into());
    let builder = tauri::WebviewWindowBuilder::new(&app, "dashboard", url)
        .title("AI Assistant - Dashboard")
        .inner_size(900.0, 680.0)
        .min_inner_size(700.0, 500.0)
        .center()
        .visible(true)
        .skip_taskbar(true)
        .content_protected(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    apply_background_process_style(&window);

    Ok(())
}

/// Toggle dashboard visibility.
#[tauri::command]
pub async fn toggle_dashboard(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("dashboard") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e: tauri::Error| e.to_string())?;
        } else {
            window.show().map_err(|e: tauri::Error| e.to_string())?;
            window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        }
    } else {
        open_dashboard(app).await?;
    }
    Ok(())
}

/// Move the window by arrow key direction.
#[tauri::command]
pub async fn move_window(
    window: WebviewWindow,
    direction: String,
    step: i32,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let (x, y) = match direction.as_str() {
        "up" => (position.x, position.y - step),
        "down" => (position.x, position.y + step),
        "left" => (position.x - step, position.y),
        "right" => (position.x + step, position.y),
        _ => return Err(format!("Invalid direction: {}", direction)),
    };
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}