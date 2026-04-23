use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, WebviewWindow};

/// Registered shortcut storage.
pub struct RegisteredShortcuts {
    pub shortcuts: Mutex<HashMap<String, String>>,
}

/// Update global keyboard shortcuts from frontend config.
///
/// TODO: Register actual global shortcuts via tauri-plugin-global-shortcut.
/// TODO: When implementing, validate shortcut keys against an allowlist of
///       supported actions and acceptable modifier+key patterns before
///       registering to prevent unexpected system shortcut conflicts.
#[tauri::command]
pub async fn update_shortcuts(
    _app: AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    let allowed_actions = [
        "toggle_overlay", "focus_input", "open_dashboard",
        "take_screenshot", "start_listening", "stop_listening",
    ];
    for action in shortcuts.keys() {
        if !allowed_actions.contains(&action.as_str()) {
            return Err(format!("Unknown shortcut action: {action}"));
        }
    }
    Ok(())
}

/// Get the currently registered shortcuts.
#[tauri::command]
pub async fn get_registered_shortcuts() -> Result<HashMap<String, String>, String> {
    log::debug!("[Shortcuts] get_registered_shortcuts");
    Ok(HashMap::new())
}

/// Toggle window always-on-top.
#[tauri::command]
pub async fn set_always_on_top(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gracefully exit the app.
#[tauri::command]
pub async fn exit_app(app: AppHandle) -> Result<(), String> {
    log::info!("[App] Exiting...");
    app.exit(0);
    Ok(())
}
