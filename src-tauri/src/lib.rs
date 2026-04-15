use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod api;
mod auth;
mod capture;
mod shortcuts;
mod speaker;
mod streaming_stt;
mod window;

/// Run the Tauri application.
pub fn run() {
    // Load .env file (keys for AI/STT providers)
    if let Err(e) = dotenvy::dotenv() {
        eprintln!("[Init] Warning: .env file not loaded: {}", e);
    }

    tauri::Builder::default()
        // --- Managed State ---
        .manage(speaker::commands::SpeakerState::default())
        .manage(streaming_stt::StreamingSttState::default())
        // --- Plugins ---
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ),
        )
        // --- App setup ---
        .setup(|app| {
            let main_window = app.get_webview_window("main")
                .expect("main window not found");

            // Position window at top center of screen
            window::setup_main_window(&main_window)?;

            // Open the auth gate window immediately on startup.
            // The gate will call unlock_app once the user is authenticated.
            let gate_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                window::open_gate(gate_handle).await.ok();
            });

            // Register global shortcut: Ctrl+Shift+H → smart toggle overlay
            // Hidden → show+focus | Visible+unfocused → focus | Visible+focused → hide
            let h1 = app.handle().clone();
            app.global_shortcut().on_shortcut("ctrl+shift+h", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(w) = h1.get_webview_window("main") {
                        let visible = w.is_visible().unwrap_or(false);
                        let focused = w.is_focused().unwrap_or(false);
                        if !visible {
                            let _ = w.show();
                            let _ = w.set_focus();
                        } else if !focused {
                            let _ = w.set_focus();
                        } else {
                            let _ = w.hide();
                        }
                    }
                }
            }).unwrap_or_else(|e| eprintln!("[GlobalShortcut] Failed to register Ctrl+Shift+H: {}", e));

            // Register global shortcut: Ctrl+Shift+I → focus overlay + input field
            let h2 = app.handle().clone();
            app.global_shortcut().on_shortcut("ctrl+shift+i", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(w) = h2.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("focus-input", ());
                    }
                }
            }).unwrap_or_else(|e| eprintln!("[GlobalShortcut] Failed to register Ctrl+Shift+I: {}", e));

            Ok(())
        })
        // --- IPC Command Handlers ---
        .invoke_handler(tauri::generate_handler![
            // Window commands
            window::unlock_app,
            window::open_gate,
            window::set_window_height,
            window::open_dashboard,
            window::toggle_dashboard,
            window::toggle_overlay,
            window::move_window,
            // Screenshot commands
            capture::start_screen_capture,
            capture::capture_to_base64,
            capture::capture_selected_area,
            capture::close_overlay_window,
            // Shortcut commands
            shortcuts::update_shortcuts,
            shortcuts::get_registered_shortcuts,
            shortcuts::set_always_on_top,
            shortcuts::exit_app,
            // Audio capture commands
            speaker::commands::start_vad_capture,
            speaker::commands::stop_vad_capture,
            speaker::commands::start_continuous_capture,
            speaker::commands::stop_continuous_capture,
            speaker::commands::update_vad_config,
            speaker::commands::get_vad_config,
            speaker::commands::get_audio_devices,
            speaker::commands::check_audio_permissions,
            speaker::commands::request_audio_permissions,
            // Auth commands
            auth::start_oauth_callback_server,
            // API commands
            api::get_ai_config,
            api::check_license_status,
            // Streaming STT commands
            streaming_stt::open_realtime_stt,
            streaming_stt::close_realtime_stt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
