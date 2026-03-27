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
/// TODO: Route shortcut events to frontend via `shortcut_triggered` event.
#[tauri::command]
pub async fn update_shortcuts(
    _app: AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    println!("[Shortcuts] Updating {} shortcuts", shortcuts.len());
    for (action, key) in &shortcuts {
        println!("[Shortcuts]   {} → {}", action, key);
    }
    Ok(())
}

/// Get the currently registered shortcuts.
#[tauri::command]
pub async fn get_registered_shortcuts() -> Result<HashMap<String, String>, String> {
    println!("[Shortcuts] get_registered_shortcuts");
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
    println!("[App] Exiting...");
    app.exit(0);
    Ok(())
}
