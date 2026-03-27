use tauri::Manager;

mod api;
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

            Ok(())
        })
        // --- IPC Command Handlers ---
        .invoke_handler(tauri::generate_handler![
            // Window commands
            window::set_window_height,
            window::open_dashboard,
            window::toggle_dashboard,
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
