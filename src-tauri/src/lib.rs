use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod api;
mod app_context;
mod auth;
mod capture;
mod context_db;
mod privacy_filter;
mod screen_reader;
mod shortcuts;
mod speaker;
mod streaming_stt;
mod usage;
mod window;

/// Run the Tauri application.
pub fn run() {
    // Load .env file (keys for AI/STT providers)
    if let Err(e) = dotenvy::dotenv() {
        log::warn!("[Init] .env file not loaded: {}", e);
    }

    tauri::Builder::default()
        // --- Managed State ---
        .manage(speaker::commands::SpeakerState::default())
        .manage(streaming_stt::StreamingSttState::default())
        .manage(api::AiRequestCounter::default())
        .manage(capture::CaptureCooldown::default())
        .manage(window::AuthState::default())
        .manage(app_context::AppContextState::default())
        // --- Plugins ---
        .plugin(
            tauri_plugin_log::Builder::new()
                // Debug/info in dev builds; only warnings and errors in release
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Warn })
                .build(),
        )
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

            // Create the auth gate window (hidden — React shows it when ready).
            // The gate will call unlock_app once the user is authenticated.
            let gate_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                window::create_gate_hidden(gate_handle).await.ok();
            });

            // Register global shortcut: Ctrl+Shift+H → smart toggle overlay
            // Hidden → show pill bar | Visible+unfocused → focus | Visible+focused → collapse to icon
            // Only fires when the user is authenticated.
            let h1 = app.handle().clone();
            app.global_shortcut().on_shortcut("ctrl+shift+h", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if !h1.state::<window::AuthState>().is_unlocked() {
                        return;
                    }
                    if let Some(w) = h1.get_webview_window("main") {
                        let visible = w.is_visible().unwrap_or(false);
                        if !visible {
                            // Window fully hidden → show and expand to pill
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("expand-pill", ());
                        } else {
                            // Window visible (icon or pill) → toggle pill mode
                            let _ = w.set_focus();
                            let _ = w.emit("toggle-pill-mode", ());
                        }
                    }
                }
            }).unwrap_or_else(|e| log::error!("[GlobalShortcut] Failed to register Ctrl+Shift+H: {}", e));

            // Register global shortcut: Ctrl+Shift+I → focus overlay + input field
            // Only fires when the user is authenticated.
            let h2 = app.handle().clone();
            app.global_shortcut().on_shortcut("ctrl+shift+i", move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if !h2.state::<window::AuthState>().is_unlocked() {
                        return;
                    }
                    if let Some(w) = h2.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("focus-input", ());
                    }
                }
            }).unwrap_or_else(|e| log::error!("[GlobalShortcut] Failed to register Ctrl+Shift+I: {}", e));

            Ok(())
        })
        // --- IPC Command Handlers ---
        .invoke_handler(tauri::generate_handler![
            // Window commands
            window::unlock_app,
            window::lock_app,
            window::open_gate,
            window::show_gate,
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
            // Screen reader (UIAutomation — replaces screenshot for text extraction)
            screen_reader::read_active_window_context,
            // App context watcher (background RAG capture)
            app_context::start_context_watcher,
            app_context::stop_context_watcher,
            app_context::get_watcher_status,
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
            // API commands — AI requests are proxied through Rust (keys never reach frontend)
            api::stream_ai_request,
            // Usage tracking — writes counters via server API key (users have no write access)
            usage::initialize_user_usage,
            usage::record_usage,
            usage::push_local_usage,
            // Streaming STT commands
            streaming_stt::open_realtime_stt,
            streaming_stt::close_realtime_stt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
