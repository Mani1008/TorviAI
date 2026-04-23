use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow};

/// Apply Windows-specific style to hide window from taskbar Apps section.
/// Forces the window into Background Processes in Task Manager.
/// 
/// Uses a hidden owner window technique: Task Manager lists a process under
/// "Apps" when it owns a visible top-level window with no owner. By creating
/// a hidden owner and reparenting, the visible window is no longer "top-level
/// ownerless" and the process drops to Background Processes.

#[cfg(target_os = "windows")]
static HIDDEN_OWNER: std::sync::OnceLock<isize> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
fn get_hidden_owner() -> winapi::shared::windef::HWND {
    *HIDDEN_OWNER.get_or_init(|| {
        unsafe {
            // Create a hidden top-level popup window to serve as owner.
            // Must be a real top-level window (NOT HWND_MESSAGE) so it can
            // be a valid owner for other top-level windows.
            let class_name: Vec<u16> = "TorviHiddenOwner\0".encode_utf16().collect();
            let wc = winapi::um::winuser::WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(winapi::um::winuser::DefWindowProcW),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: std::ptr::null_mut(),
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: class_name.as_ptr(),
            };
            winapi::um::winuser::RegisterClassW(&wc);

            // WS_EX_TOOLWINDOW on the owner itself prevents it from ever
            // appearing in Alt-Tab or the taskbar. WS_POPUP makes it a
            // valid top-level owner. NULL parent → desktop-level.
            let hwnd = winapi::um::winuser::CreateWindowExW(
                winapi::um::winuser::WS_EX_TOOLWINDOW as u32,
                class_name.as_ptr(),
                std::ptr::null(),
                winapi::um::winuser::WS_POPUP as u32,
                0, 0, 0, 0,
                std::ptr::null_mut(), // no parent — top-level
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
            // Never call ShowWindow — keep it hidden
            hwnd as isize
        }
    }) as winapi::shared::windef::HWND
}

#[cfg(target_os = "windows")]
fn apply_background_process_style(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let hwnd_ptr = hwnd.0 as winapi::shared::windef::HWND;
            let hidden_owner = get_hidden_owner();

            // Set hidden owner so this window is no longer "top-level ownerless"
            winapi::um::winuser::SetWindowLongPtrW(
                hwnd_ptr,
                winapi::um::winuser::GWL_HWNDPARENT,
                hidden_owner as isize,
            );

            // Also apply WS_EX_TOOLWINDOW and remove WS_EX_APPWINDOW for belt-and-braces
            winapi::um::winuser::SetWindowLongPtrW(
                hwnd_ptr,
                winapi::um::winuser::GWL_EXSTYLE,
                (winapi::um::winuser::GetWindowLongPtrW(
                    hwnd_ptr,
                    winapi::um::winuser::GWL_EXSTYLE,
                ) & !(winapi::um::winuser::WS_EX_APPWINDOW as isize))
                | winapi::um::winuser::WS_EX_TOOLWINDOW as isize,
            );
            winapi::um::winuser::SetWindowPos(
                hwnd_ptr,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                winapi::um::winuser::SWP_NOMOVE
                    | winapi::um::winuser::SWP_NOSIZE
                    | winapi::um::winuser::SWP_NOZORDER
                    | winapi::um::winuser::SWP_FRAMECHANGED,
            );
        }
    }
}

/// Set up the main window position (top center of primary monitor).
pub fn setup_main_window(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // Start collapsed — just the toolbar height
    let _ = window.set_size(LogicalSize::new(600.0, 44.0));

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

    // Pill bar starts hidden — shown only after the user authenticates via the gate window.
    // Call unlock_app from the frontend once auth is confirmed.

    // Hide from taskbar Apps section → move to Background Processes
    #[cfg(target_os = "windows")]
    apply_background_process_style(window);

    Ok(())
}

/// Called from the frontend after successful authentication.
/// Shows the pill bar and hides the gate window.
#[tauri::command]
pub async fn unlock_app(app: AppHandle) -> Result<(), String> {
    // Show the pill bar
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e: tauri::Error| e.to_string())?;
        main.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        #[cfg(target_os = "windows")]
        apply_background_process_style(&main);
    }
    // Hide the gate window (don't destroy — user can open it again from Settings)
    if let Some(gate) = app.get_webview_window("gate") {
        gate.hide().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

/// Opens (or shows) the gate/auth window.
#[tauri::command]
pub async fn open_gate(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("gate") {
        window.show().map_err(|e: tauri::Error| e.to_string())?;
        window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        #[cfg(target_os = "windows")]
        apply_background_process_style(&window);
        return Ok(());
    }
    create_gate_window(&app, true).await
}

/// Creates the gate window hidden — React will call show_gate when ready.
pub async fn create_gate_hidden(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window("gate").is_some() {
        return Ok(());
    }
    create_gate_window(&app, false).await
}

/// Show the gate window (called from frontend when the sign-in UI is ready).
#[tauri::command]
pub async fn show_gate(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("gate") {
        window.show().map_err(|e: tauri::Error| e.to_string())?;
        window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
        #[cfg(target_os = "windows")]
        apply_background_process_style(&window);
    }
    Ok(())
}

/// Internal: builds the gate webview window.
async fn create_gate_window(app: &AppHandle, show: bool) -> Result<(), String> {
    let url = WebviewUrl::App("/gate".into());
    let window = tauri::WebviewWindowBuilder::new(app, "gate", url)
        .title("Torvi — Sign In")
        .inner_size(480.0, 600.0)
        .resizable(false)
        .center()
        .visible(false)
        .decorations(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    if show {
        window.show().map_err(|e: tauri::Error| e.to_string())?;
        window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    apply_background_process_style(&window);

    let _ = window;
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
        #[cfg(target_os = "windows")]
        apply_background_process_style(&window);
        return Ok(());
    }

    let url = WebviewUrl::App("/dashboard".into());
    let builder = tauri::WebviewWindowBuilder::new(&app, "dashboard", url)
        .title("AI Assistant - Dashboard")
        .inner_size(900.0, 680.0)
        .min_inner_size(700.0, 500.0)
        .center()
        .visible(false)
        .decorations(false)
        .skip_taskbar(true)
        .content_protected(false);

    let window = builder.build().map_err(|e| e.to_string())?;

    window.show().map_err(|e: tauri::Error| e.to_string())?;
    window.set_focus().map_err(|e: tauri::Error| e.to_string())?;

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
            #[cfg(target_os = "windows")]
            apply_background_process_style(&window);
        }
    } else {
        open_dashboard(app).await?;
    }
    Ok(())
}

/// Toggle the main overlay window visibility.
#[tauri::command]
pub async fn toggle_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            window.hide().map_err(|e: tauri::Error| e.to_string())?;
        } else {
            window.show().map_err(|e: tauri::Error| e.to_string())?;
            window.set_focus().map_err(|e: tauri::Error| e.to_string())?;
            #[cfg(target_os = "windows")]
            apply_background_process_style(&window);
        }
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