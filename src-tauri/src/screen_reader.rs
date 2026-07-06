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

        // Extract all visible text using the multi-strategy fallback chain.
        let text_content =
            extract_text(&element, &automation, &app_name).unwrap_or_default();

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

/// Try strategies ordered from most-specific to most-general.
///
/// Strategy 0 — VS Code / Cursor / other Electron editors:
///   Specifically target the active editor Document pane, skipping the sidebar,
///   panel, status bar, and file explorer that pollute Strategy 1 captures.
///
/// Strategy 1 — TextPattern on root element (Word, Notepad, terminal, etc.)
///
/// Strategy 1.5 — TextPattern on Document descendant (Chrome/Edge/Firefox)
///
/// Strategy 2 — ValuePattern (single-line inputs)
///
/// Strategy 3 — Tree walk (fallback for anything else)
/// True when the foreground app is VS Code, Cursor, or a VS Code fork.
#[cfg(target_os = "windows")]
fn is_vscode_like_app(app_name: &str, window_title: &str) -> bool {
    let app_lower = app_name.to_lowercase();
    let title_lower = window_title.to_lowercase();
    app_lower == "cursor"
        || app_lower == "code"
        || app_lower.contains("vscode")
        || title_lower.contains("visual studio code")
        || title_lower.contains(" - cursor")
        || title_lower.contains(" — cursor")
}

#[cfg(target_os = "windows")]
unsafe fn extract_text(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    app_name: &str,
) -> windows::core::Result<String> {
    use windows::Win32::UI::Accessibility::*;

    // ── Strategy 0: VS Code / Cursor — jump directly to the editor pane ────────
    //
    // VS Code's UIAutomation tree:
    //   Window "file.ts — project — Visual Studio Code"
    //     Pane  AutomationId="workbench.parts.editor"
    //       Document (active tab, IUIAutomationTextPattern-accessible)
    //
    // The window-level TextPattern (Strategy 1) returns the ENTIRE accessibility
    // tree: Explorer sidebar, Outline, Source Control, NPM scripts, breadcrumbs,
    // status bar, terminal panel — everything.  We must bypass it for VS Code.
    //
    // Modern VS Code/Cursor also renders via the EditContext API: visible lines
    // appear as `.view-line` elements whose Name holds the line text.  Without
    // screen-reader mode, TextPattern on the editor pane often returns nothing —
    // view-line collection is the reliable path for partial (viewport) content.
    {
        let window_title = element.CurrentName().unwrap_or_default().to_string();
        let is_vscode_like = is_vscode_like_app(app_name, &window_title);

        if is_vscode_like {
            // Attempt 1: Find the editor-container pane by AutomationId.
            let editor_pane_ids = ["workbench.parts.editor", "editor container"];
            for pane_id in &editor_pane_ids {
                let id_bstr = windows::core::BSTR::from(*pane_id);
                if let Ok(cond) = automation.CreatePropertyCondition(
                    UIA_AutomationIdPropertyId,
                    &windows::core::VARIANT::from(id_bstr),
                ) {
                    if let Ok(editor_pane) = element.FindFirst(TreeScope_Descendants, &cond) {
                        // 1a. TextPattern on Document descendants (full doc when a11y mode on).
                        if let Ok(doc_cond) = automation.CreatePropertyCondition(
                            UIA_ControlTypePropertyId,
                            &windows::core::VARIANT::from(UIA_DocumentControlTypeId.0),
                        ) {
                            if let Ok(doc_array) =
                                editor_pane.FindAll(TreeScope_Descendants, &doc_cond)
                            {
                                let count = doc_array.Length().unwrap_or(0);
                                let mut best = String::new();
                                for idx in 0..count {
                                    if let Ok(doc_el) = doc_array.GetElement(idx) {
                                        if let Some(s) = text_from_element(&doc_el) {
                                            if s.len() > best.len() {
                                                best = s;
                                            }
                                        }
                                    }
                                }
                                if best.len() > 100 {
                                    return Ok(truncate_text(best, 20_000));
                                }
                            }
                        }

                        // 1b. Visible viewport lines (.view-line) inside the editor pane.
                        if let Some(lines) = collect_view_line_text(&editor_pane, automation) {
                            if lines.len() > 80 {
                                return Ok(truncate_text(lines, 20_000));
                            }
                        }

                        // 1c. TextPattern directly on the editor pane element.
                        if let Some(s) = text_from_element(&editor_pane) {
                            if s.len() > 100 {
                                return Ok(truncate_text(s, 20_000));
                            }
                        }
                        break;
                    }
                }
            }

            // Attempt 2: native-edit-context (EditContext API in modern VS Code).
            for edit_id in &["native-edit-context", "vscode-text-input"] {
                let id_bstr = windows::core::BSTR::from(*edit_id);
                if let Ok(cond) = automation.CreatePropertyCondition(
                    UIA_AutomationIdPropertyId,
                    &windows::core::VARIANT::from(id_bstr),
                ) {
                    if let Ok(edit_el) = element.FindFirst(TreeScope_Descendants, &cond) {
                        if let Some(s) = text_from_element(&edit_el) {
                            if s.len() > 80 {
                                return Ok(truncate_text(s, 20_000));
                            }
                        }
                    }
                }
            }

            // Attempt 3: monaco-editor element (ClassName may include extra tokens).
            if let Some(s) = collect_text_by_class_substring(element, automation, "monaco-editor", 25) {
                if s.len() > 100 {
                    return Ok(truncate_text(s, 20_000));
                }
            }

            // Attempt 4: Focused element + ancestors (caret is usually in the editor).
            if let Some(s) = text_from_focused_element(automation) {
                if s.len() > 80 {
                    return Ok(truncate_text(s, 20_000));
                }
            }

            // Attempt 5: Collect all visible .view-line text from the whole window.
            if let Some(lines) = collect_view_line_text(element, automation) {
                if lines.len() > 80 {
                    return Ok(truncate_text(lines, 20_000));
                }
            }

            // VS Code detected but editor selectors failed (Welcome tab, Settings, etc.).
            // Use a scoped walk that skips Header/Outline nodes — never Strategy 1.
            return walk_children(element, automation, 0, false);
        }
    }

    // ── Strategy 1: TextPattern on root (Word, Notepad, terminals, etc.) ─────
    // Safe for non-VS-Code apps.  VS Code returns early above before reaching here.
    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
    {
        if let Ok(range) = pattern.DocumentRange() {
            if let Ok(text) = range.GetText(-1) {
                let s = text.to_string();
                if !s.is_empty() {
                    return Ok(truncate_text(s, 20_000));
                }
            }
        }
    }

    // ── Strategy 1.5a: Browser RootWebArea — most targeted for Chromium apps ──
    // In Chrome/Edge/Brave/Vivaldi the webpage content is wrapped in an element
    // with AutomationId = "RootWebArea".  Finding it directly skips all browser
    // chrome: address bar, bookmarks bar, tab strip, extension buttons, sidebar.
    // For non-browser apps this FindFirst will simply return an error → fall through.
    //
    // CRITICAL: when TextPattern on the web element fails (e.g. Google Docs renders
    // its content on a <canvas> that is invisible to TextPattern), we MUST fall back
    // to a filtered tree walk scoped to the web_el — NOT to the root window element.
    // Walking from the root would escape the RootWebArea boundary and read all of
    // Chrome's own toolbar/menu/bookmarks chrome again.
    {
        let root_web_area_bstr = windows::core::BSTR::from("RootWebArea");
        if let Ok(cond) = automation.CreatePropertyCondition(
            UIA_AutomationIdPropertyId,
            &windows::core::VARIANT::from(root_web_area_bstr),
        ) {
            if let Ok(web_el) = element.FindFirst(TreeScope_Descendants, &cond) {
                // Attempt A: TextPattern (rich apps like Claude.ai, Notion, Slack web).
                if let Ok(pattern) =
                    web_el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                {
                    if let Ok(range) = pattern.DocumentRange() {
                        if let Ok(text) = range.GetText(-1) {
                            let s = text.to_string();
                            if s.len() > 50 {
                                return Ok(truncate_text(s, 20_000));
                            }
                        }
                    }
                }

                // Attempt B: scoped filtered walk within RootWebArea.
                // Used for Google Docs (canvas-rendered), Google Sheets, and other
                // web apps where TextPattern returns nothing.
                // By walking from web_el we stay entirely inside the webpage —
                // Chrome toolbars, menus, and extension buttons are outside this subtree.
                let scoped = walk_children(&web_el, automation, 0, false);
                if let Ok(text) = scoped {
                    if text.len() > 50 {
                        return Ok(truncate_text(text, 20_000));
                    }
                }

                // Even if the scoped walk returned nothing useful, return empty rather
                // than falling through to a full-window walk.  An empty capture is
                // better than polluting the context store with toolbar noise.
                return Ok(String::new());
            }
        }
    }

    // Strategy 1.5b — TextPattern on first Document descendant.
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
                                return Ok(truncate_text(s, 20_000));
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
    walk_children(element, automation, 0, false)
}

/// Read text via TextPattern or ValuePattern from a single element.
#[cfg(target_os = "windows")]
unsafe fn text_from_element(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
) -> Option<String> {
    use windows::Win32::UI::Accessibility::*;

    if let Ok(pattern) =
        element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
    {
        if let Ok(range) = pattern.DocumentRange() {
            if let Ok(text) = range.GetText(-1) {
                let s = text.to_string();
                if !s.trim().is_empty() {
                    return Some(s);
                }
            }
        }
    }

    let is_pw = element
        .CurrentIsPassword()
        .map(|b| b.as_bool())
        .unwrap_or(false);
    if !is_pw {
        if let Ok(pattern) =
            element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        {
            if let Ok(val) = pattern.CurrentValue() {
                let s = val.to_string();
                if !s.trim().is_empty() {
                    return Some(s);
                }
            }
        }
    }

    None
}

/// Collect visible editor lines from Monaco's `.view-line` elements.
#[cfg(target_os = "windows")]
unsafe fn collect_view_line_text(
    root: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    collect_view_lines_recursive(root, automation, 0, 25, &mut lines);
    if lines.is_empty() {
        return None;
    }
    let joined = lines.join("\n");
    if joined.trim().len() < 20 {
        return None;
    }
    Some(joined)
}

#[cfg(target_os = "windows")]
unsafe fn collect_view_lines_recursive(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    depth: u32,
    max_depth: u32,
    lines: &mut Vec<String>,
) {
    if depth > max_depth {
        return;
    }

    let class = element
        .CurrentClassName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    if class.contains("view-line") {
        if let Some(text) = text_from_element(element) {
            let trimmed = text.trim();
            if trimmed.len() >= 2 {
                lines.push(trimmed.to_string());
            }
        } else if let Ok(name) = element.CurrentName() {
            let s = name.to_string();
            if s.trim().len() >= 2 {
                lines.push(s.trim().to_string());
            }
        }
    }

    let condition = match automation.CreateTrueCondition() {
        Ok(c) => c,
        Err(_) => return,
    };
    let walker = match automation.CreateTreeWalker(&condition) {
        Ok(w) => w,
        Err(_) => return,
    };

    let first_child = match walker.GetFirstChildElement(element) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut child = first_child;
    loop {
        collect_view_lines_recursive(&child, automation, depth + 1, max_depth, lines);
        match walker.GetNextSiblingElement(&child) {
            Ok(next) => child = next,
            Err(_) => break,
        }
    }
}

/// Collect the longest TextPattern/Name text from elements whose ClassName contains `needle`.
#[cfg(target_os = "windows")]
unsafe fn collect_text_by_class_substring(
    root: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    needle: &str,
    max_depth: u32,
) -> Option<String> {
    let mut best = String::new();
    collect_class_text_recursive(root, automation, needle, 0, max_depth, &mut best);
    if best.is_empty() {
        None
    } else {
        Some(best)
    }
}

#[cfg(target_os = "windows")]
unsafe fn collect_class_text_recursive(
    element: &windows::Win32::UI::Accessibility::IUIAutomationElement,
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
    needle: &str,
    depth: u32,
    max_depth: u32,
    best: &mut String,
) {
    if depth > max_depth {
        return;
    }

    let class = element
        .CurrentClassName()
        .map(|s| s.to_string())
        .unwrap_or_default();
    if class.contains(needle) {
        if let Some(text) = text_from_element(element) {
            if text.len() > best.len() {
                *best = text;
            }
        }
    }

    let condition = match automation.CreateTrueCondition() {
        Ok(c) => c,
        Err(_) => return,
    };
    let walker = match automation.CreateTreeWalker(&condition) {
        Ok(w) => w,
        Err(_) => return,
    };

    let first_child = match walker.GetFirstChildElement(element) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut child = first_child;
    loop {
        collect_class_text_recursive(&child, automation, needle, depth + 1, max_depth, best);
        match walker.GetNextSiblingElement(&child) {
            Ok(next) => child = next,
            Err(_) => break,
        }
    }
}

/// Try TextPattern on the focused element and up to five ancestors.
#[cfg(target_os = "windows")]
unsafe fn text_from_focused_element(
    automation: &windows::Win32::UI::Accessibility::IUIAutomation,
) -> Option<String> {
    let focused = automation.GetFocusedElement().ok()?;
    let condition = automation.CreateTrueCondition().ok()?;
    let walker = automation.CreateTreeWalker(&condition).ok()?;

    let mut current = focused;
    for _ in 0..6 {
        if let Some(text) = text_from_element(&current) {
            if text.len() > 80 {
                return Some(text);
            }
        }
        current = walker.GetParentElement(&current).ok()?;
    }
    None
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
    include_headers: bool,
) -> windows::core::Result<String> {
    if depth > 15 {
        return Ok(String::new());
    }

    use windows::Win32::UI::Accessibility::*;

    // Control type IDs whose Name property represents readable content.
    // Header types are excluded by default — they capture outline/breadcrumb
    // headings in VS Code and browser chrome, not document body text.
    let content_types: &[UIA_CONTROLTYPE_ID] = if include_headers {
        &[
            UIA_EditControlTypeId,
            UIA_HyperlinkControlTypeId,
            UIA_TextControlTypeId,
            UIA_TreeItemControlTypeId,
            UIA_DataItemControlTypeId,
            UIA_DocumentControlTypeId,
            UIA_HeaderControlTypeId,
            UIA_HeaderItemControlTypeId,
        ]
    } else {
        &[
            UIA_EditControlTypeId,
            UIA_HyperlinkControlTypeId,
            UIA_TextControlTypeId,
            UIA_TreeItemControlTypeId,
            UIA_DataItemControlTypeId,
            UIA_DocumentControlTypeId,
        ]
    };

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
        UIA_TabControlTypeId,   // browser tab strip — leaks tab titles as nav noise
        UIA_TabItemControlTypeId,
        UIA_CheckBoxControlTypeId,
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
            if content_types.contains(&ctrl) {
                if let Ok(name) = child.CurrentName() {
                    let s = name.to_string();
                    if s.len() > 1 {
                        parts.push(s);
                    }
                }
            }

            // Recurse into container / unknown elements.
            if let Ok(nested) = walk_children(&child, automation, depth + 1, include_headers) {
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

/// Truncate `s` to at most `max_chars` CHARACTERS (not bytes), breaking at the
/// last newline or space before the limit where possible.
///
/// Previous implementation used `s.len()` (bytes) and `&s[..max_chars]` (byte
/// slice), which panics whenever a multi-byte character (e.g. U+EAB4, VS Code
/// Nerd Font icons, CJK text) straddles the byte boundary.  This version always
/// operates on character counts and char-boundary-safe indices.
fn truncate_text(s: String, max_chars: usize) -> String {
    // Count characters (not bytes).
    let char_count = s.chars().count();
    if char_count <= max_chars {
        return s;
    }

    // Find the byte offset of `max_chars`-th character — always a valid boundary.
    let byte_limit = s
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(s.len());

    let slice = &s[..byte_limit];

    // Prefer breaking at the last newline or space so we don't cut mid-word.
    match slice.rfind('\n').or_else(|| slice.rfind(' ')) {
        Some(pos) => s[..pos].to_string(),
        None => slice.to_string(),
    }
}
