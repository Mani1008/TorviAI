//! Background app-context watcher.
//!
//! Polls the foreground window every 5 seconds via `screen_reader`, applies the
//! privacy filter, deduplicates by content hash, and emits a `context-captured`
//! Tauri event.  The TypeScript layer receives these events and writes the chunks
//! to the local SQLite `context_chunks` table.

use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use tokio::sync::mpsc;

use crate::privacy_filter::PrivacyFilter;

// ─── Types ────────────────────────────────────────────────────────────────────

/// A single screen-context snapshot emitted to the frontend.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AppContextSnapshot {
    pub app_name: String,
    pub window_title: String,
    pub text_content: String,
    pub content_type: String,
    pub content_hash: String,
    pub url: Option<String>,
    pub captured_at: i64,
}

// ─── Managed state ────────────────────────────────────────────────────────────

/// Shared state used to start/stop the watcher from any Tauri command.
pub struct AppContextState {
    pub running: Arc<AtomicBool>,
}

impl Default for AppContextState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Start the background context watcher (no-op if already running).
///
/// The watcher runs on a Tokio async task; UIAutomation calls are dispatched to
/// blocking threads so they do not starve the executor.
#[tauri::command]
pub async fn start_context_watcher(
    app: AppHandle,
    state: tauri::State<'_, AppContextState>,
) -> Result<(), String> {
    // Atomically flip running: false → true.  If it was already true, bail out.
    if state
        .running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::Relaxed)
        .is_err()
    {
        log::debug!("[ContextWatcher] Already running — ignoring start request.");
        return Ok(());
    }

    let running = Arc::clone(&state.running);
    let app_handle = app.clone();

    tokio::spawn(run_watcher_loop(running, app_handle));
    log::info!("[ContextWatcher] Started.");
    Ok(())
}

/// Stop the background context watcher.
#[tauri::command]
pub fn stop_context_watcher(state: tauri::State<'_, AppContextState>) {
    state.running.store(false, Ordering::SeqCst);
    log::info!("[ContextWatcher] Stopped.");
}

/// Returns "running" or "stopped" — lightweight status poll for the dashboard.
#[tauri::command]
pub fn get_watcher_status(state: tauri::State<'_, AppContextState>) -> &'static str {
    if state.running.load(Ordering::Relaxed) {
        "running"
    } else {
        "stopped"
    }
}

// ─── Watcher loop ─────────────────────────────────────────────────────────────

/// Platform-specific watcher loop.
///
/// On Windows this combines two triggers:
///   1. **WinEvent hook** — `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` fires
///      instantly whenever the user switches to a different window (e.g. Alt-Tab,
///      clicks a taskbar icon).  The hook callback sends a signal on an mpsc
///      channel.  The hook must live on a thread that pumps a Win32 message loop.
///   2. **5-second timer** — catches content that changes within the same window
///      (user types in a doc, page loads in a browser, etc.) without a focus change.
///
/// Both triggers feed into a single capture/emit path.
#[cfg(target_os = "windows")]
async fn run_watcher_loop(running: Arc<AtomicBool>, app: AppHandle) {
    // Channel: WinEvent thread → async loop (capacity 4 is plenty; we only need
    // one pending signal at a time — extras are coalesced by the debounce below).
    let (tx, mut rx) = mpsc::channel::<()>(4);
    let running_hook = Arc::clone(&running);

    // Spawn a dedicated OS thread to own the WinEvent hook + message pump.
    // SetWinEventHook requires WINEVENT_OUTOFCONTEXT *or* a thread with a message
    // loop.  We use WINEVENT_OUTOFCONTEXT so the callback runs on this same thread
    // after DispatchMessage, which is the safest approach.
    std::thread::spawn(move || {
        winevent_message_pump(tx, running_hook);
    });

    let filter = PrivacyFilter::new();
    let mut last_hash = String::new();
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
    // Don't fire immediately on start — wait for the first tick.
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        // Wait for whichever comes first: a WinEvent signal or the 5-second timer.
        tokio::select! {
            _ = rx.recv() => {
                // Window switched — debounce so the new window has time to
                // paint and its UIAutomation tree stabilises.
                // 300 ms is enough for the shell to complete the focus transition;
                // shorter values capture mid-render garbage on slower machines.
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                // Drain any extra signals that piled up during the debounce.
                while rx.try_recv().is_ok() {}
            }
            _ = interval.tick() => {
                // Periodic timer — capture even if no focus change occurred.
            }
        }

        if !running.load(Ordering::Relaxed) {
            break;
        }

        // UIAutomation COM calls must run on a blocking thread.
        let ctx = match tokio::task::spawn_blocking(
            crate::screen_reader::read_blocking_internal,
        )
        .await
        {
            Ok(Ok(c)) => c,
            Ok(Err(e)) => {
                log::debug!("[ContextWatcher] Read failed: {e}");
                continue;
            }
            Err(e) => {
                log::warn!("[ContextWatcher] spawn_blocking panicked: {e}");
                continue;
            }
        };

        if !filter.should_capture(&ctx) {
            continue;
        }

        let raw = filter.redact_sensitive(&ctx.text_content);
        let text = clean_captured_text(&raw);

        if text.trim().len() < 20 {
            continue;
        }

        let hash = {
            let mut hasher = Sha256::new();
            hasher.update(text.as_bytes());
            hex::encode(hasher.finalize())
        };

        if hash == last_hash {
            continue;
        }
        last_hash = hash.clone();

        let parsed_title = parse_window_title(&ctx.app_name, &ctx.window_title);
        let content_type =
            classify_context(&ctx.app_name, &parsed_title, ctx.url.as_deref());

        let snapshot = AppContextSnapshot {
            app_name: ctx.app_name,
            window_title: parsed_title,
            text_content: text,
            content_type: content_type.to_string(),
            content_hash: hash,
            url: ctx.url,
            captured_at: ctx.captured_at,
        };

        if let Err(e) = app.emit("context-captured", &snapshot) {
            log::warn!("[ContextWatcher] Failed to emit context-captured: {e}");
        }
    }

    log::info!("[ContextWatcher] Loop exited.");
}

// ─── WinEvent message pump ────────────────────────────────────────────────────

/// Runs on a dedicated OS thread.  Installs a WinEvent hook for
/// EVENT_SYSTEM_FOREGROUND (fires when the foreground window changes) and pumps
/// the Win32 message loop until `running` is cleared.
#[cfg(target_os = "windows")]
fn winevent_message_pump(tx: mpsc::Sender<()>, running: Arc<AtomicBool>) {
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent};
    use windows::Win32::UI::WindowsAndMessaging::{
        TranslateMessage, DispatchMessageW, MSG,
        WINEVENT_OUTOFCONTEXT, EVENT_SYSTEM_FOREGROUND,
    };

    // Store the sender in a thread-local so the callback (a bare fn pointer) can
    // reach it without capturing.
    TX_SLOT.with(|slot| {
        *slot.borrow_mut() = Some(tx);
    });

    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,               // hmodWinEventProc — None for OUTOFCONTEXT
            Some(foreground_event_proc),
            0,                  // idProcess — 0 = all processes
            0,                  // idThread  — 0 = all threads
            WINEVENT_OUTOFCONTEXT,
        )
    };

    if hook.is_invalid() {
        log::warn!("[ContextWatcher] SetWinEventHook failed — falling back to timer-only mode.");
        TX_SLOT.with(|slot| slot.borrow_mut().take());
        return;
    }

    // Classic Win32 message pump.  GetMessageW blocks until a message arrives.
    // The WinEvent callback is delivered here via WINEVENT_OUTOFCONTEXT.
    let mut msg = MSG::default();
    loop {
        if !running.load(Ordering::Relaxed) {
            break;
        }
        // Peek / get with a timeout — re-check `running` every ~200 ms.
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{
                MsgWaitForMultipleObjects, PeekMessageW, PM_REMOVE, QS_ALLINPUT,
            };
            // Wait up to 200 ms for a message so we can poll `running`.
            MsgWaitForMultipleObjects(None, false, 200, QS_ALLINPUT);
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }

    unsafe { let _ = UnhookWinEvent(hook); };
    TX_SLOT.with(|slot| slot.borrow_mut().take());
    log::info!("[ContextWatcher] WinEvent hook unregistered.");
}

// Thread-local channel sender used by the WinEvent callback.
#[cfg(target_os = "windows")]
thread_local! {
    static TX_SLOT: std::cell::RefCell<Option<mpsc::Sender<()>>> =
        const { std::cell::RefCell::new(None) };
}

/// WinEvent callback — called on the hook thread when the foreground window changes.
/// Must be a bare `unsafe extern "system" fn`; cannot capture.
#[cfg(target_os = "windows")]
unsafe extern "system" fn foreground_event_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK,
    _event: u32,
    _hwnd: windows::Win32::Foundation::HWND,
    _id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _event_time: u32,
) {
    TX_SLOT.with(|slot| {
        if let Some(tx) = slot.borrow().as_ref() {
            // try_send: non-blocking, drop signal if channel is full (backpressure).
            let _ = tx.try_send(());
        }
    });
}

/// Stub for non-Windows — watcher is a no-op.
#[cfg(not(target_os = "windows"))]
async fn run_watcher_loop(running: Arc<AtomicBool>, _app: AppHandle) {
    log::info!("[ContextWatcher] UIAutomation not available on this platform.");
    running.store(false, Ordering::SeqCst);
}

// ─── Text cleaning ────────────────────────────────────────────────────────────

/// VS Code Source Control sidebar headings / UI labels that pollute captures.
/// Matched as exact-trimmed lines (case-sensitive).
const VSCODE_NOISE_LINES: &[&str] = &[
    "CHANGES",
    "STAGED CHANGES",
    "MERGE CHANGES",
    "REPOSITORIES",
    "SOURCE CONTROL",
    "EXPLORER",
    "SEARCH",
    "EXTENSIONS",
    "GIT GRAPH",
    "GRAPHGR…",
    "Auto",
    "Commit",
    "Message (Ctrl+Enter to commit on \"main\")",
    "Message (Ctrl+Enter to co…",
    "Views and More Actions...",
    "Launch Profile...",
    "More Actions",
    "New Chat",
    "CODEBASE ANALYSIS AND UNDERSTANDING",
    "PROBLEMS",
    "OUTPUT",
    "DEBUG CONSOLE",
    "TERMINAL",
    "PORTS",
    "GIT",
    "The editor is not accessible at this time. To enable screen reader optimized mode, use Shift+Alt+F1",
    "Terminal input",
    "Use Alt+F1 for terminal accessibility help",
];

/// Clean up raw UIAutomation-captured text before storing in the context DB.
///
/// Steps:
/// 1. Remove U+FFFC (Object Replacement Character) — generated by icon/image elements.
/// 2. Remove other non-printable ASCII control characters (keep newline, tab, CR).
/// 3. Split into lines; drop lines that are:
///    a. Shorter than 3 printable characters (UI chrome badges: "M", "U", "1", etc.)
///    b. Known VS Code / editor UI noise strings.
///    c. Composed entirely of repeated punctuation/separators (e.g. "─────────").
/// 4. Collapse runs of 3+ blank lines into a single blank line.
/// 5. Trim overall leading/trailing whitespace.
fn clean_captured_text(raw: &str) -> String {
    // Step 1+2: strip U+FFFC and non-printable control chars
    let cleaned: String = raw
        .chars()
        .filter(|c| {
            // Drop Object Replacement Character (icon placeholder)
            if *c == '\u{FFFC}' { return false; }
            // Keep newline / carriage return / tab
            if *c == '\n' || *c == '\r' || *c == '\t' { return true; }
            // Drop other C0/C1 control characters
            let code = *c as u32;
            !(code < 0x20 || (code >= 0x7F && code <= 0x9F))
        })
        .collect();

    // Step 3: filter lines
    let mut out_lines: Vec<&str> = Vec::new();
    let mut blank_run = 0usize;

    for line in cleaned.lines() {
        let trimmed = line.trim();

        // Skip empty — track run length for collapse
        if trimmed.is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out_lines.push("");
            }
            continue;
        }
        blank_run = 0;

        // Skip very short lines (icon badges, count numbers, single letters)
        let printable_len = trimmed.chars().filter(|c| !c.is_whitespace()).count();
        if printable_len < 3 {
            continue;
        }

        // Skip known VS Code UI noise strings
        if VSCODE_NOISE_LINES.iter().any(|noise| trimmed == *noise) {
            continue;
        }

        // Skip separator lines (≥ 60% repeated punctuation: ─, ━, ═, -, =, ·, •)
        let sep_chars = trimmed.chars().filter(|c| "─━═-=·•|/\\~".contains(*c)).count();
        if sep_chars > 0 && sep_chars * 10 >= trimmed.chars().count() * 6 {
            continue;
        }

        out_lines.push(line);
    }

    out_lines.join("\n").trim().to_string()
}

// ─── Window title parser ─────────────────────────────────────────────────────

/// Parse a raw window title into a structured, human-readable form.
///
/// Strips the redundant trailing app-name segment and extracts the semantically
/// meaningful parts using app-specific rules:
///
/// | App            | Raw title                              | Parsed                    |
/// |----------------|----------------------------------------|---------------------------|
/// | VS Code/Cursor | `main.rs — torvi — Visual Studio Code` | `main.rs \| torvi`        |
/// | Slack          | `#engineering — Acme HQ`              | `#engineering \| Acme HQ` |
/// | Word           | `Q3 Report.docx — Microsoft Word`      | `Q3 Report.docx`          |
/// | Outlook        | `RE: Budget Review - Outlook`          | `RE: Budget Review`       |
/// | Teams          | `General \| Engineering \| Teams`      | `General \| Engineering`  |
/// | Generic        | `Foo — Bar — AppName`                  | `Foo \| Bar`              |
fn parse_window_title(app_name: &str, title: &str) -> String {
    // Separator candidates, ordered by specificity.
    // Em dash (U+2014) is most common in modern apps; en dash and hyphen are fallbacks.
    const SEPS: &[&str] = &[" \u{2014} ", " \u{2013} ", " - ", " | "];

    // Find the first separator that appears in the title.
    let sep = match SEPS.iter().find(|&&s| title.contains(s)) {
        Some(s) => *s,
        None => return title.to_string(),
    };

    let parts: Vec<&str> = title.split(sep).collect();
    if parts.len() < 2 {
        return title.to_string();
    }

    let app_lower = app_name.to_lowercase();

    // Known app-name substrings that appear as the trailing segment of a title.
    // We strip any trailing part whose lowercase form contains one of these.
    const APP_SUFFIXES: &[&str] = &[
        "visual studio code",
        "vs code",
        "cursor",
        "microsoft word",
        "microsoft excel",
        "microsoft powerpoint",
        "microsoft outlook",
        "microsoft teams",
        "google chrome",
        "mozilla firefox",
        "microsoft edge",
        "notepad++",
        "sublime text",
        "intellij idea",
        "pycharm",
        "webstorm",
        "rider",
        "android studio",
        "slack",
        "discord",
        "zoom",
        "figma",
        "notion",
    ];

    // Walk from the end and drop parts that are just the app name.
    let meaningful: Vec<&str> = {
        let mut v: Vec<&str> = parts.iter().copied().collect();
        while let Some(last) = v.last() {
            let lower = last.trim().to_lowercase();
            let is_app = APP_SUFFIXES.iter().any(|k| lower.contains(k))
                || lower.contains(&app_lower)
                || lower.is_empty();
            if is_app {
                v.pop();
            } else {
                break;
            }
        }
        v
    };

    if meaningful.is_empty() {
        return title.to_string();
    }

    // App-specific shaping of the remaining parts.
    match app_lower.as_str() {
        a if a.contains("code") || a.contains("cursor") => {
            // VS Code / Cursor: "filename — project" → "filename | project"
            match meaningful.as_slice() {
                [file, project, ..] => format!("{} | {}", file.trim(), project.trim()),
                [file] => file.trim().to_string(),
                _ => meaningful.iter().map(|p| p.trim()).collect::<Vec<_>>().join(" | "),
            }
        }
        a if a.contains("slack") => {
            // Slack: "#channel — Workspace" → "#channel | Workspace"
            match meaningful.as_slice() {
                [channel, workspace, ..] => {
                    format!("{} | {}", channel.trim(), workspace.trim())
                }
                [channel] => channel.trim().to_string(),
                _ => meaningful.iter().map(|p| p.trim()).collect::<Vec<_>>().join(" | "),
            }
        }
        a if a.contains("teams") => {
            // Teams: "Channel | Team" — keep both
            match meaningful.as_slice() {
                [channel, team, ..] => format!("{} | {}", channel.trim(), team.trim()),
                [channel] => channel.trim().to_string(),
                _ => meaningful.iter().map(|p| p.trim()).collect::<Vec<_>>().join(" | "),
            }
        }
        a if a.contains("winword")
            || a.contains("excel")
            || a.contains("powerpnt")
            || a.contains("onenote") =>
        {
            // Office: "Document.docx — Word" → "Document.docx"
            meaningful[0].trim().to_string()
        }
        a if a.contains("outlook") || a.contains("thunderbird") => {
            // Email: "RE: Subject - Outlook" → "RE: Subject"
            meaningful[0].trim().to_string()
        }
        _ => {
            // Generic: join remaining parts
            let joined = meaningful
                .iter()
                .map(|p| p.trim())
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join(" | ");
            if joined.is_empty() {
                title.to_string()
            } else {
                joined
            }
        }
    }
}

// ─── Context classifier ───────────────────────────────────────────────────────


/// Classify the content type based on app name, parsed window title, and optional URL.
fn classify_context(app_name: &str, title: &str, url: Option<&str>) -> &'static str {
    if let Some(u) = url {
        if u.contains("mail.google.com") || u.contains("outlook.live.com") {
            return "email";
        }
        if u.contains("linear.app")
            || u.contains("jira.atlassian")
            || u.contains("trello.com")
            || u.contains("asana.com")
        {
            return "project_management";
        }
        if u.contains("notion.so")
            || u.contains("docs.google.com")
            || u.contains("confluence")
        {
            return "document";
        }
        if u.contains("github.com") || u.contains("gitlab.com") || u.contains("bitbucket.org") {
            return "code";
        }
        if u.contains("meet.google.com")
            || u.contains("teams.microsoft.com")
            || u.contains("zoom.us")
        {
            return "meeting";
        }
        if u.contains("slack.com") || u.contains("discord.com") {
            return "chat";
        }
    }

    let app = app_name.to_lowercase();
    match app.as_str() {
        // Teams can be either a meeting or a chat window — use the title to distinguish.
        a if a.contains("teams") => {
            let t = title.to_lowercase();
            if t.contains("meeting")
                || t.contains("call")
                || t.contains("conference")
                || t.contains("join now")
            {
                "meeting"
            } else {
                "chat"
            }
        }
        a if a.contains("slack") || a.contains("discord") => "chat",
        a if a.contains("winword")
            || a.contains("notion")
            || a.contains("obsidian")
            || a.contains("onenote") =>
        {
            "document"
        }
        a if a.contains("code")
            || a.contains("rider")
            || a.contains("idea")
            || a.contains("studio")
            || a.contains("sublime") =>
        {
            "code"
        }
        a if a.contains("zoom") || a.contains("webex") => "meeting",
        a if a.contains("outlook") || a.contains("thunderbird") => "email",
        _ => "generic",
    }
}
