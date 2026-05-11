//! Windows UIAutomation-based screen text reader.
//!
//! Reads visible text from the foreground window without taking a screenshot.
//! - No image encoding / vision API tokens needed.
//! - Natively skips password fields.
//! - Returns clean, structured text in < 50 ms on modern hardware.
//!
//! Falls back to an error on non-Windows platforms.

use serde::Serialize;

/// All text and metadata extracted from the active window.
#[derive(Debug, Clone, Serialize)]
pub struct WindowContext {
    /// Executable stem (no extension), e.g. "chrome", "Code", "Slack"
    pub app_name: String,
    /// Window title-bar text
    pub window_title: String,
    /// Concatenated visible, non-password text from the UI element tree
    pub text_content: String,
    /// Browser address-bar URL when running in a recognised browser
    pub url: Option<String>,
    /// Unix timestamp (seconds) of capture
    pub captured_at: i64,
}

// ─── Tauri command ────────────────────────────────────────────────────────────

/// Read the foreground window's text via UIAutomation.
///
/// Dispatched to a blocking thread-pool thread so the COM call does not block
/// the async Tokio executor.
#[tauri::command]
pub async fn read_active_window_context() -> Result<WindowContext, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(read_blocking_internal)
            .await
            .map_err(|e| format!("Task join error: {e}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("UIAutomation screen reading is only supported on Windows.".to_string())
    }
}

// ─── Internal blocking implementation (Windows only) ─────────────────────────

/// Called from both the Tauri command and the background context watcher.
#[cfg(target_os = "windows")]
pub(crate) fn read_blocking_internal() -> Result<WindowContext, String> {
    use windows::{
        Win32::{
            Foundation::*,
            System::Com::*,
            UI::Accessibility::*,
            UI::WindowsAndMessaging::GetForegroundWindow,
        },
    };

    unsafe {
        // Initialise COM on this thread (multi-threaded apartment — safe for thread pool).
        // S_FALSE means already initialised on this thread, which is also acceptable.
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() && hr != S_FALSE {
            hr.ok().map_err(|e| format!("CoInitializeEx failed: {e}"))?;
        }

        // RAII guard: uninitialise COM when this stack frame exits.
        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe { CoUninitialize(); }
            }
        }
        let _guard = ComGuard;

        // Create the UIAutomation factory.
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_ALL)
                .map_err(|e| format!("Failed to create IUIAutomation: {e}"))?;

        // Get the element for the currently focused foreground window.
        let hwnd = GetForegroundWindow();
        let element = automation
            .ElementFromHandle(hwnd)
            .map_err(|e| format!("ElementFromHandle: {e}"))?;

        let title = element.CurrentName().map(|s| s.to_string()).unwrap_or_default();
        let pid = element.CurrentProcessId().unwrap_or(0) as u32;
        let app_name =
            get_process_name(pid).unwrap_or_else(|_| "Unknown".to_string());

        // Extract all visible text using the 3-strategy fallback chain.
        let text_content = extract_text(&element, &automation).unwrap_or_default();

        // Best-effort URL extraction for Chromium-based browsers.
        let url = extract_browser_url(&automation, &app_name);

        let captured_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        Ok(WindowContext {
            app_name,
            window_title: title,
            text_content,
            url,
            captured_at,
        })
    }
}

// ─── Text extraction strategies ──────────────────────────────────────────────

/// Try four strategies: TextPattern on root → TextPattern on Document descendant → ValuePattern → tree walk.
#[cfg(target_os = "windows")]
unsafe fn extract_text(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
) -> windows::core::Result<String> {
    use windows::Win32::UI::Accessibility::*;

    // Strategy 1 — TextPattern: richest source (browsers, Word, VS Code, terminals)
    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
    {
        if let Ok(range) = pattern.DocumentRange() {
            if let Ok(text) = range.GetText(-1) {
                let s = text.to_string();
                if !s.is_empty() {
                    return Ok(truncate_text(s, 8_000));
                }
            }
        }
    }

    // Strategy 1.5 — TextPattern on first Document descendant.
    // Chrome, Edge and Firefox don't expose IUIAutomationTextPattern on the root
    // window element, but the inner web-content pane
    // (ControlType = UIA_DocumentControlTypeId = 50030) does.  This is the
    // correct way to read page body text without capturing browser UI chrome
    // (toolbar buttons, address bar, bookmarks, extension names, tab list).
    {
        use windows::core::VARIANT;
        if let Ok(cond) = automation.CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_DocumentControlTypeId.0), // inner i32 value = 50030
        ) {
            if let Ok(doc_el) = element.FindFirst(TreeScope_Descendants, &cond) {
                if let Ok(pattern) =
                    doc_el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                {
                    if let Ok(range) = pattern.DocumentRange() {
                        if let Ok(text) = range.GetText(-1) {
                            let s = text.to_string();
                            // Only return if there is meaningful content (> 50 chars
                            // filters out empty document shell elements).
                            if s.len() > 50 {
                                return Ok(truncate_text(s, 8_000));
                            }
                        }
                    }
                }
            }
        }
    }

    // Strategy 2 — ValuePattern: single-line inputs; always skip password fields.
    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
    {
        let is_pw = element
            .CurrentIsPassword()
            .map(|b| b.as_bool())
            .unwrap_or(false);
        if !is_pw {
            if let Ok(val) = pattern.CurrentValue() {
                let s = val.to_string();
                if !s.is_empty() {
                    return Ok(s);
                }
            }
        }
    }

    // Strategy 3 — Walk the element tree and concatenate Name properties.
    walk_children(element, automation, 0)
}

/// Recursively walk the element tree collecting visible text (max depth 15).
///
/// Apps like VS Code and Chrome have element trees 80–100 levels deep.  A cap
/// of 15 balances coverage against latency — the vast majority of user-visible
/// text lives within the first 10–12 levels.
///
/// Only collects `Name` from *content* control types (Text, Document, Edit,
/// Hyperlink, TreeItem …).  Skips UI-chrome leaf nodes (Button, ToolBar,
/// MenuItem, ScrollBar, TitleBar …) entirely so window controls, extension
/// buttons, and bookmark entries do not pollute the captured text.
#[cfg(target_os = "windows")]
unsafe fn walk_children(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    depth: u32,
) -> windows::core::Result<String> {
    if depth > 15 {
        return Ok(String::new());
    }

    use windows::Win32::UI::Accessibility::*;

    // Control type IDs whose Name property represents readable content.
    const CONTENT_TYPES: &[UIA_CONTROLTYPE_ID] = &[
        UIA_EditControlTypeId,
        UIA_HyperlinkControlTypeId,
        UIA_TextControlTypeId,
        UIA_TreeItemControlTypeId,
        UIA_DataItemControlTypeId,
        UIA_DocumentControlTypeId,
        UIA_HeaderControlTypeId,
        UIA_HeaderItemControlTypeId,
    ];

    // UI-chrome types — skip entirely (no Name collection, no recursion).
    // These account for ~90 % of the noise seen in browser captures.
    const SKIP_TYPES: &[UIA_CONTROLTYPE_ID] = &[
        UIA_ButtonControlTypeId,     // Minimize, Maximize, Close, Back, Forward, extensions
        UIA_MenuControlTypeId,
        UIA_MenuBarControlTypeId,
        UIA_MenuItemControlTypeId,
        UIA_ProgressBarControlTypeId,
        UIA_RadioButtonControlTypeId,
        UIA_ScrollBarControlTypeId,
        UIA_SliderControlTypeId,
        UIA_SpinnerControlTypeId,
        UIA_StatusBarControlTypeId,  // "Memory usage — 178 MB", etc.
        UIA_ToolBarControlTypeId,    // navigation bar, bookmarks bar
        UIA_ToolTipControlTypeId,
        UIA_ThumbControlTypeId,
        UIA_SplitButtonControlTypeId,
        UIA_TitleBarControlTypeId,
        UIA_SeparatorControlTypeId,
        UIA_AppBarControlTypeId,
    ];

    let condition = automation.CreateTrueCondition()?;
    let walker = automation.CreateTreeWalker(&condition)?;

    let mut parts: Vec<String> = Vec::new();

    let first_child = match walker.GetFirstChildElement(element) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()),
    };

    let mut child = first_child;
    loop {
        let ctrl = child.CurrentControlType().unwrap_or(UIA_CustomControlTypeId);

        // Skip UI-chrome leaf nodes entirely — no Name, no recursion.
        if SKIP_TYPES.contains(&ctrl) {
            match walker.GetNextSiblingElement(&child) {
                Ok(next) => { child = next; continue; }
                Err(_) => break,
            }
        }

        // Always skip password fields.
        let is_pw = child
            .CurrentIsPassword()
            .map(|b| b.as_bool())
            .unwrap_or(false);

        if !is_pw {
            // Collect Name only from elements that carry readable content.
            if CONTENT_TYPES.contains(&ctrl) {
                if let Ok(name) = child.CurrentName() {
                    let s = name.to_string();
                    if s.len() > 1 {
                        parts.push(s);
                    }
                }
            }

            // Recurse into container / unknown elements.
            if let Ok(nested) = walk_children(&child, automation, depth + 1) {
                if !nested.is_empty() {
                    parts.push(nested);
                }
            }
        }

        match walker.GetNextSiblingElement(&child) {
            Ok(next) => child = next,
            Err(_) => break,
        }
    }

    Ok(parts.join("\n"))
}

// ─── Process name ─────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
unsafe fn get_process_name(pid: u32) -> windows::core::Result<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::{
        core::PWSTR,
        Win32::{
            Foundation::CloseHandle,
            System::Threading::*,
        },
    };

    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)?;

    let mut buf = vec![0u16; 260];
    let mut size = buf.len() as u32;
    let result = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_FORMAT(0), // PROCESS_NAME_WIN32 = 0
        PWSTR(buf.as_mut_ptr()),
        &mut size,
    );
    let _ = CloseHandle(handle);
    result?;

    let path = OsString::from_wide(&buf[..size as usize]);
    let name = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    Ok(name)
}

// ─── Browser URL extraction ───────────────────────────────────────────────────

/// Read the address-bar URL from the foreground window of a supported browser.
///
/// Handles Chrome/Brave/Vivaldi/Opera (automation ID: "omnibox-input"),
/// Microsoft Edge ("addressEditBox"), and Firefox ("urlbar-input").
/// Returns None if the focused app is not a recognised browser or on any error.
#[cfg(target_os = "windows")]
unsafe fn extract_browser_url(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    app_name: &str,
) -> Option<String> {
    use windows::Win32::UI::Accessibility::*;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let browsers = ["chrome", "msedge", "brave", "vivaldi", "opera", "firefox"];
    let app_lower = app_name.to_lowercase();
    if !browsers.iter().any(|b| app_lower.contains(b)) {
        return None;
    }

    // Automation IDs for the address bar across different browsers:
    //   Chrome / Brave / Vivaldi / Opera : "omnibox-input"
    //   Microsoft Edge                   : "addressEditBox"
    //   Firefox                          : "urlbar-input"
    let address_bar_ids = ["omnibox-input", "addressEditBox", "urlbar-input"];

    // Try the currently focused element first (address bar is often focused).
    let focused = automation.GetFocusedElement().ok()?;
    let auto_id = focused.CurrentAutomationId().ok()?.to_string();
    if address_bar_ids.iter().any(|id| auto_id == *id) {
        if let Ok(pattern) =
            focused.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        {
            let val = pattern.CurrentValue().ok()?.to_string();
            if val.starts_with("http://") || val.starts_with("https://") {
                return Some(val);
            }
        }
    }

    // Fallback: search the window's element tree for a known address-bar element.
    let hwnd = GetForegroundWindow();
    let root = automation.ElementFromHandle(hwnd).ok()?;
    for bar_id in &address_bar_ids {
        let id_bstr = windows::core::BSTR::from(*bar_id);
        if let Ok(cond) = automation.CreatePropertyCondition(
            UIA_AutomationIdPropertyId,
            &windows::core::VARIANT::from(id_bstr),
        ) {
            if let Ok(bar_element) = root.FindFirst(TreeScope_Descendants, &cond) {
                if let Ok(pattern) = bar_element
                    .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                {
                    let val = pattern.CurrentValue().ok()?.to_string();
                    if val.starts_with("http://") || val.starts_with("https://") {
                        return Some(val);
                    }
                }
            }
        }
    }

    None
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/// Truncate `s` to at most `max_chars`, breaking at the last newline or space.
fn truncate_text(s: String, max_chars: usize) -> String {
    if s.len() <= max_chars {
        return s;
    }
    let slice = &s[..max_chars];
    match slice.rfind('\n').or_else(|| slice.rfind(' ')) {
        Some(pos) => s[..pos].to_string(),
        None => slice.to_string(),
    }
}
