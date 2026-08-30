//! Extract Windows application icons via Win32 `SHGetFileInfo`.
//!
//! Returns a base64 PNG string for React:
//! `<img src={`data:image/png;base64,${icon}`} />`
//!
//! Never panics — returns `""` on any failure.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Process-wide icon cache (base64 PNG keyed by lowercase app name / path).
pub struct IconCache(pub Mutex<HashMap<String, String>>);

impl Default for IconCache {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

/// Resolve an app name / exe / .lnk path and return a base64 PNG icon.
/// Returns `""` when the icon cannot be resolved (never errors to the frontend).
#[tauri::command]
pub fn get_app_icon(app_name: &str, cache: State<'_, IconCache>) -> String {
    let key = app_name.trim().to_lowercase();
    if key.is_empty() {
        return String::new();
    }

    if let Ok(guard) = cache.0.lock() {
        if let Some(hit) = guard.get(&key) {
            return hit.clone();
        }
    }

    #[cfg(target_os = "windows")]
    let result = extract_icon_base64(app_name.trim()).unwrap_or_default();

    #[cfg(not(target_os = "windows"))]
    let result = String::new();

    if let Ok(mut guard) = cache.0.lock() {
        guard.insert(key, result.clone());
    }

    result
}

#[cfg(target_os = "windows")]
fn extract_icon_base64(app_name: &str) -> Option<String> {
    let path = resolve_icon_source(app_name)?;
    let png = extract_icon_png(&path).ok()?;
    Some(BASE64.encode(png))
}

// ─── Path resolution ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn resolve_icon_source(app_name: &str) -> Option<PathBuf> {
    let trimmed = app_name.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_file() {
        let is_lnk = candidate
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("lnk"))
            == Some(true);

        if is_lnk {
            // Never return the .lnk itself — SHGetFileInfo stamps the shortcut arrow overlay.
            if let Some(target) = resolve_shortcut_icon_path(&candidate) {
                return Some(target);
            }
            // Fall through to name-based lookup using the shortcut's display stem
            if let Some(stem) = candidate.file_stem().and_then(|s| s.to_str()) {
                if let Some(sys) = known_system_exe(stem) {
                    return Some(sys);
                }
            }
            return None;
        }
        return Some(candidate);
    }

    let with_ext = if trimmed.to_lowercase().ends_with(".exe") {
        trimmed.to_string()
    } else {
        format!("{trimmed}.exe")
    };
    let stem = with_ext
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string();

    // Known System32 utilities keyed by Start Menu display name
    if let Some(sys) = known_system_exe(trimmed) {
        return Some(sys);
    }

    // 1. App Paths registry — HKLM then HKCU (fastest for installed apps)
    for name in [&with_ext, &stem, &format!("{stem}.exe")] {
        if let Some(found) = lookup_app_paths_registry(name, true) {
            return Some(found);
        }
        if let Some(found) = lookup_app_paths_registry(name, false) {
            return Some(found);
        }
    }

    // 2. PATH
    if let Some(found) = which_in_path(&with_ext) {
        return Some(found);
    }

    // 3. Program Files / LOCALAPPDATA (depth 3)
    for root in search_roots() {
        if let Some(found) = find_exe_under(&root, &with_ext, 3) {
            return Some(found);
        }
        // Also try matching by display-name-ish stem inside folder names
        if let Some(found) = find_exe_fuzzy(&root, &stem, 3) {
            return Some(found);
        }
    }

    // 4. where.exe last resort
    if let Some(found) = where_exe(&stem) {
        return Some(found);
    }

    None
}

#[cfg(target_os = "windows")]
fn known_system_exe(name: &str) -> Option<PathBuf> {
    let lower = name.to_lowercase();
    let map: &[(&str, &str)] = &[
        ("character map", r"C:\Windows\System32\charmap.exe"),
        ("charmap", r"C:\Windows\System32\charmap.exe"),
        ("command prompt", r"C:\Windows\System32\cmd.exe"),
        ("cmd", r"C:\Windows\System32\cmd.exe"),
        ("powershell", r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
        ("windows powershell", r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
        ("notepad", r"C:\Windows\System32\notepad.exe"),
        ("paint", r"C:\Windows\System32\mspaint.exe"),
        ("snipping tool", r"C:\Windows\System32\SnippingTool.exe"),
        ("task manager", r"C:\Windows\System32\Taskmgr.exe"),
        ("registry editor", r"C:\Windows\regedit.exe"),
        ("calculator", r"C:\Windows\System32\calc.exe"),
    ];
    for (key, path) in map {
        if lower == *key || lower.replace(' ', "") == key.replace(' ', "") {
            let p = PathBuf::from(path);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn which_in_path(file_name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(file_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "LOCALAPPDATA"] {
        if let Ok(val) = std::env::var(key) {
            let p = PathBuf::from(val);
            if p.is_dir() && !roots.iter().any(|e: &PathBuf| e == &p) {
                roots.push(p);
            }
        }
    }
    for fallback in [r"C:\Program Files", r"C:\Program Files (x86)"] {
        let p = PathBuf::from(fallback);
        if p.is_dir() && !roots.iter().any(|e| e == &p) {
            roots.push(p);
        }
    }
    roots
}

#[cfg(target_os = "windows")]
fn find_exe_under(dir: &Path, file_name: &str, max_depth: usize) -> Option<PathBuf> {
    find_exe_under_inner(dir, &file_name.to_lowercase(), max_depth)
}

#[cfg(target_os = "windows")]
fn find_exe_under_inner(dir: &Path, target_lower: &str, depth: usize) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.eq_ignore_ascii_case(target_lower) {
                    return Some(path);
                }
            }
        } else if path.is_dir() && depth > 0 {
            // Skip heavy / irrelevant trees
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let lower = name.to_lowercase();
            if lower == "windowsapps"
                || lower == "windows defender"
                || lower.starts_with('$')
            {
                continue;
            }
            dirs.push(path);
        }
    }

    if depth == 0 {
        return None;
    }
    for sub in dirs {
        if let Some(found) = find_exe_under_inner(&sub, target_lower, depth - 1) {
            return Some(found);
        }
    }
    None
}

/// Prefer `{stem}\{stem}.exe` or first `.exe` inside a folder named like the app.
#[cfg(target_os = "windows")]
fn find_exe_fuzzy(dir: &Path, stem: &str, max_depth: usize) -> Option<PathBuf> {
    let stem_lower = stem.to_lowercase().replace(' ', "");
    if stem_lower.len() < 3 {
        return None;
    }
    find_exe_fuzzy_inner(dir, &stem_lower, max_depth)
}

#[cfg(target_os = "windows")]
fn find_exe_fuzzy_inner(dir: &Path, stem_lower: &str, depth: usize) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut dirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase()
                .replace(' ', "");
            if name.contains(stem_lower) || stem_lower.contains(&name) {
                // Look for matching exe inside this folder (shallow)
                if let Some(found) = find_exe_under(&path, &format!("{stem_lower}.exe"), 2) {
                    return Some(found);
                }
                // Any single .exe in the folder root
                if let Ok(inner) = std::fs::read_dir(&path) {
                    for e in inner.flatten() {
                        let p = e.path();
                        if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("exe")) == Some(true)
                        {
                            return Some(p);
                        }
                    }
                }
            }
            if depth > 0 {
                dirs.push(path);
            }
        }
    }

    if depth == 0 {
        return None;
    }
    for sub in dirs {
        if let Some(found) = find_exe_fuzzy_inner(&sub, stem_lower, depth - 1) {
            return Some(found);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn where_exe(name: &str) -> Option<PathBuf> {
    let output = std::process::Command::new("where.exe")
        .arg(name)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first = stdout.lines().next()?.trim();
    let path = PathBuf::from(first);
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn lookup_app_paths_registry(exe_name: &str, hklm: bool) -> Option<PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        KEY_READ, REG_SZ,
    };

    let subkey = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe_name}");
    let subkey_wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
    let root = if hklm {
        HKEY_LOCAL_MACHINE
    } else {
        HKEY_CURRENT_USER
    };

    unsafe {
        let mut hkey = std::mem::zeroed();
        let status = RegOpenKeyExW(root, PCWSTR(subkey_wide.as_ptr()), 0, KEY_READ, &mut hkey);
        if status != ERROR_SUCCESS {
            return None;
        }

        let mut data_type = REG_SZ;
        let mut data_len: u32 = 0;
        let _ = RegQueryValueExW(
            hkey,
            PCWSTR::null(),
            None,
            Some(&mut data_type),
            None,
            Some(&mut data_len),
        );

        if data_len == 0 {
            let _ = RegCloseKey(hkey);
            return None;
        }

        let mut buf = vec![0u8; data_len as usize];
        let status = RegQueryValueExW(
            hkey,
            PCWSTR::null(),
            None,
            Some(&mut data_type),
            Some(buf.as_mut_ptr()),
            Some(&mut data_len),
        );
        let _ = RegCloseKey(hkey);
        if status != ERROR_SUCCESS {
            return None;
        }

        let wide: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .take_while(|&c| c != 0)
            .collect();
        let path_str = String::from_utf16_lossy(&wide)
            .trim()
            .trim_matches('"')
            .to_string();
        // Expand env vars like %ProgramFiles%
        let expanded = expand_env(&path_str);
        let path = PathBuf::from(expanded);
        if path.is_file() {
            Some(path)
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn expand_env(value: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::System::Environment::ExpandEnvironmentStringsW;

    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let needed = ExpandEnvironmentStringsW(PCWSTR(wide.as_ptr()), None);
        if needed == 0 {
            return value.to_string();
        }
        let mut buf = vec![0u16; needed as usize];
        let written = ExpandEnvironmentStringsW(PCWSTR(wide.as_ptr()), Some(&mut buf));
        if written == 0 {
            return value.to_string();
        }
        String::from_utf16_lossy(&buf[..written as usize - 1])
    }
}

// ─── Shortcut resolution ─────────────────────────────────────────────────────

/// Resolve a `.lnk` to a path we can extract a *clean* icon from (no shortcut arrow).
/// Prefers `GetIconLocation`, then the shortcut target (file or folder).
/// Also used by `installed_apps` so exclusions key off real process names.
#[cfg(target_os = "windows")]
pub(crate) fn resolve_shortcut_icon_path(lnk: &Path) -> Option<PathBuf> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let path_str = lnk.to_str()?;
    let path_wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let shell_link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = shell_link.cast().ok()?;
        persist.Load(PCWSTR(path_wide.as_ptr()), STGM_READ).ok()?;

        // 1) Explicit icon resource on the shortcut (often an .exe/.dll + index)
        let mut icon_buf = [0u16; 260];
        let mut icon_index: i32 = 0;
        if shell_link
            .GetIconLocation(&mut icon_buf, &mut icon_index)
            .is_ok()
        {
            let len = icon_buf.iter().position(|&c| c == 0).unwrap_or(icon_buf.len());
            let icon_path = String::from_utf16_lossy(&icon_buf[..len]);
            let icon_path = icon_path.trim().trim_matches('"');
            if !icon_path.is_empty() {
                let expanded = PathBuf::from(expand_env(icon_path));
                if expanded.is_file() {
                    return Some(expanded);
                }
            }
        }

        // 2) Shortcut target — file or folder (folders get a clean shell icon)
        let mut buf = [0u16; 260];
        if shell_link
            .GetPath(
                &mut buf,
                std::ptr::null_mut(),
                windows::Win32::UI::Shell::SLGP_RAWPATH.0 as u32,
            )
            .is_ok()
        {
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let target = String::from_utf16_lossy(&buf[..len]);
            let target = target.trim().trim_matches('"');
            if !target.is_empty() {
                let path = PathBuf::from(expand_env(target));
                if path.is_file() || path.is_dir() {
                    return Some(path);
                }
            }
        }

        None
    }
}

// ─── Icon extraction ─────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn extract_icon_png(path: &Path) -> Result<Vec<u8>, String> {
    use image::{ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{
        ExtractIconExW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    // Refuse .lnk — callers must resolve first (avoids blue shortcut arrow overlay)
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("lnk"))
        == Some(true)
    {
        return Err("Refusing to extract icon from .lnk (shortcut overlay)".into());
    }

    let path_str = path
        .to_str()
        .ok_or_else(|| format!("Non-UTF8 path: {}", path.display()))?;
    let path_wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        // Prefer ExtractIconEx — pulls the resource icon without shell overlays
        let mut large: HICON = HICON::default();
        let extracted = ExtractIconExW(PCWSTR(path_wide.as_ptr()), 0, Some(&mut large), None, 1);
        let hicon = if extracted > 0 && !large.is_invalid() {
            large
        } else {
            let mut file_info: SHFILEINFOW = std::mem::zeroed();
            let result = SHGetFileInfoW(
                PCWSTR(path_wide.as_ptr()),
                Default::default(),
                Some(&mut file_info),
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            );
            if result == 0 || file_info.hIcon.is_invalid() {
                return Err(format!("Icon extract failed for '{}'", path.display()));
            }
            file_info.hIcon
        };

        // 1) Prefer the icon's own color bitmap (preserves real colors/alpha)
        let from_info = icon_pixels_from_iconinfo(hicon);
        // 2) Fallback: draw onto a 32bpp bitmap created from the *screen* DC
        let pixels_wh = from_info.or_else(|_| icon_pixels_via_draw(hicon));

        let _ = DestroyIcon(hicon);

        let (width, height, mut pixels) = pixels_wh?;

        // BGRA → RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let any_alpha = pixels.chunks_exact(4).any(|p| p[3] != 0);
        if !any_alpha {
            for chunk in pixels.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
        }

        let any_color = pixels.chunks_exact(4).any(|p| p[0] | p[1] | p[2] != 0);
        if !any_color {
            return Err("Empty icon bitmap".into());
        }

        let buffer: ImageBuffer<Rgba<u8>, _> =
            ImageBuffer::from_raw(width, height, pixels)
                .ok_or_else(|| "Failed to build image buffer".to_string())?;

        let mut png_bytes = Cursor::new(Vec::new());
        buffer
            .write_to(&mut png_bytes, ImageFormat::Png)
            .map_err(|e| format!("PNG encode failed: {e}"))?;

        let png = png_bytes.into_inner();
        if png.len() < 8 || png[0..4] != [0x89, b'P', b'N', b'G'] {
            return Err("PNG encode produced invalid bytes".into());
        }

        Ok(png)
    }
}

/// Read pixels from `ICONINFO.hbmColor` (or mask) via GetDIBits.
#[cfg(target_os = "windows")]
unsafe fn icon_pixels_from_iconinfo(
    hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
) -> Result<(u32, u32, Vec<u8>), String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, GetDC, GetDIBits, GetObjectW, ReleaseDC,
        BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    let mut info: ICONINFO = std::mem::zeroed();
    if GetIconInfo(hicon, &mut info).is_err() {
        return Err("GetIconInfo failed".into());
    }

    let hbm = if !info.hbmColor.is_invalid() {
        info.hbmColor
    } else if !info.hbmMask.is_invalid() {
        info.hbmMask
    } else {
        cleanup_iconinfo(&info);
        return Err("ICONINFO has no bitmaps".into());
    };

    let mut bm: BITMAP = std::mem::zeroed();
    let got = GetObjectW(
        HGDIOBJ(hbm.0),
        std::mem::size_of::<BITMAP>() as i32,
        Some(&mut bm as *mut _ as *mut _),
    );
    if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        cleanup_iconinfo(&info);
        return Err("GetObjectW failed for icon bitmap".into());
    }

    let width = bm.bmWidth as u32;
    let height = bm.bmHeight.unsigned_abs();

    let hdc_screen = GetDC(None);
    let hdc = CreateCompatibleDC(hdc_screen);

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: bm.bmWidth,
            biHeight: -(bm.bmHeight.abs()), // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let copied = GetDIBits(
        hdc,
        hbm,
        0,
        height,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let _ = DeleteDC(hdc);
    let _ = ReleaseDC(None, hdc_screen);
    cleanup_iconinfo(&info);

    if copied == 0 {
        return Err("GetDIBits on icon color bitmap failed".into());
    }

    Ok((width, height, pixels))
}

/// DrawIconEx onto a 32bpp bitmap created from the screen DC (never a bare mem DC).
#[cfg(target_os = "windows")]
unsafe fn icon_pixels_via_draw(
    hicon: windows::Win32::UI::WindowsAndMessaging::HICON,
) -> Result<(u32, u32, Vec<u8>), String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DrawIconEx, GetSystemMetrics, DI_NORMAL, SM_CXICON, SM_CYICON};

    let width = GetSystemMetrics(SM_CXICON).max(32);
    let height = GetSystemMetrics(SM_CYICON).max(32);

    let hdc_screen = GetDC(None);
    if hdc_screen.is_invalid() {
        return Err("GetDC failed".into());
    }

    let hdc = CreateCompatibleDC(hdc_screen);
    // MUST use screen DC here — CreateCompatibleBitmap(mem_dc) → 1bpp mono
    let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
    if hbm.is_invalid() {
        let _ = DeleteDC(hdc);
        let _ = ReleaseDC(None, hdc_screen);
        return Err("CreateCompatibleBitmap failed".into());
    }

    let old = SelectObject(hdc, HGDIOBJ(hbm.0));

    // White background so dark icons remain visible if alpha is lost
    {
        use windows::Win32::Foundation::{COLORREF, RECT};
        use windows::Win32::Graphics::Gdi::{CreateSolidBrush, FillRect};
        let brush = CreateSolidBrush(COLORREF(0x00FFFFFF));
        let rect = RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: height,
        };
        let _ = FillRect(hdc, &rect, brush);
        let _ = DeleteObject(HGDIOBJ(brush.0));
    }

    let draw_ok = DrawIconEx(hdc, 0, 0, hicon, width, height, 0, None, DI_NORMAL).is_ok();

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };

    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let copied = GetDIBits(
        hdc,
        hbm,
        0,
        height as u32,
        Some(pixels.as_mut_ptr() as *mut _),
        &mut bmi,
        DIB_RGB_COLORS,
    );

    let _ = SelectObject(hdc, old);
    let _ = DeleteObject(HGDIOBJ(hbm.0));
    let _ = DeleteDC(hdc);
    let _ = ReleaseDC(None, hdc_screen);

    if !draw_ok {
        return Err("DrawIconEx failed".into());
    }
    if copied == 0 {
        return Err("GetDIBits after DrawIconEx failed".into());
    }

    Ok((width as u32, height as u32, pixels))
}

#[cfg(target_os = "windows")]
unsafe fn cleanup_iconinfo(info: &windows::Win32::UI::WindowsAndMessaging::ICONINFO) {
    use windows::Win32::Graphics::Gdi::{DeleteObject, HGDIOBJ};
    if !info.hbmColor.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
    }
    if !info.hbmMask.is_invalid() {
        let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn extracts_system_exe_icon() {
        let path = PathBuf::from(r"C:\Windows\System32\charmap.exe");
        if !path.is_file() {
            return;
        }
        let png = extract_icon_png(&path).expect("charmap icon");
        assert!(png.len() > 100, "png too small: {}", png.len());
        assert_eq!(&png[0..4], &[0x89, b'P', b'N', b'G']);
        // Sanity: not a near-empty black square (encoded PNG of all-black is still >200 bytes usually,
        // but check for meaningful size from a real icon).
        assert!(png.len() > 200, "suspiciously small png: {}", png.len());
    }
}
