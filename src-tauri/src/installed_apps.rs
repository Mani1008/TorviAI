//! Enumerate applications for Privacy Controls (Start Menu + seen captures).

use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturableApp {
    pub id: String,
    pub display_name: String,
    /// Normalized process / blocklist key (lowercase, no .exe).
    /// Must match `WindowContext.app_name` from capture for exclusions to work.
    pub process_name: String,
    /// Absolute path to `.exe` / `.lnk` for icon extraction via `get_app_icon`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturableWebsite {
    pub id: String,
    pub host: String,
    pub sample_title: Option<String>,
}

fn normalize_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .trim_end_matches(".exe")
        .to_string()
}

fn title_from_process(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut chars = trimmed.chars();
    let Some(first) = chars.next() else {
        return trimmed.to_string();
    };
    let mut result = first.to_uppercase().collect::<String>();
    result.push_str(chars.as_str());
    result
}

fn insert_app(
    apps: &mut HashMap<String, CapturableApp>,
    display_name: &str,
    process_name: &str,
    icon_path: Option<String>,
) {
    let process = normalize_key(process_name);
    let display = display_name.trim();
    if process.is_empty() || display.is_empty() {
        return;
    }
    let id = process.clone();
    apps.entry(id.clone())
        .and_modify(|existing| {
            if existing.icon_path.is_none() {
                if let Some(path) = icon_path.clone() {
                    existing.icon_path = Some(path);
                }
            }
            // Prefer friendly Start Menu titles over bare process stems
            if display.len() > existing.display_name.len()
                || (display.contains(' ') && !existing.display_name.contains(' '))
            {
                existing.display_name = display.to_string();
            }
        })
        .or_insert_with(|| CapturableApp {
            id,
            display_name: display.to_string(),
            process_name: process,
            icon_path,
        });
}

/// Prefer the target `.exe` stem so Privacy Controls keys match live capture (`chrome`, not `Google Chrome`).
#[cfg(target_os = "windows")]
fn process_key_from_lnk(lnk: &Path, display_stem: &str) -> String {
    if let Some(target) = crate::app_icon::resolve_shortcut_icon_path(lnk) {
        if target.is_file() {
            if let Some(stem) = target.file_stem().and_then(|s| s.to_str()) {
                let key = normalize_key(stem);
                if !key.is_empty() {
                    return key;
                }
            }
        }
    }
    normalize_key(display_stem)
}

#[cfg(target_os = "windows")]
fn scan_start_menu_dir(dir: &Path, apps: &mut HashMap<String, CapturableApp>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_start_menu_dir(&path, apps);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("lnk") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.trim().is_empty() {
            continue;
        }
        let process = process_key_from_lnk(&path, stem);
        let icon_path = path.to_string_lossy().to_string();
        insert_app(apps, stem, &process, Some(icon_path));
    }
}

#[cfg(target_os = "windows")]
fn scan_start_menu_apps(apps: &mut HashMap<String, CapturableApp>) {
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let dir = PathBuf::from(program_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        scan_start_menu_dir(&dir, apps);
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let dir = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        scan_start_menu_dir(&dir, apps);
    }
}

#[cfg(not(target_os = "windows"))]
fn scan_start_menu_apps(_apps: &mut HashMap<String, CapturableApp>) {}

async fn apps_from_context_db(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
    let db = crate::context_db::ContextDb::open(app).await?;
    db.distinct_apps().await
}

/// Apps the user can exclude — Start Menu entries plus apps seen in context memory.
#[tauri::command]
pub async fn list_capturable_apps(app: AppHandle) -> Result<Vec<CapturableApp>, String> {
    let mut map: HashMap<String, CapturableApp> = HashMap::new();

    scan_start_menu_apps(&mut map);

    if let Ok(rows) = apps_from_context_db(&app).await {
        for (process_name, _sample_title) in rows {
            let display = title_from_process(&process_name);
            if display.is_empty() {
                continue;
            }
            // Process names from captures (e.g. "Cursor", "chrome") — icon resolved by name.
            insert_app(&mut map, &display, &process_name, None);
        }
    }

    let mut apps: Vec<CapturableApp> = map
        .into_values()
        .filter(|a| !a.display_name.trim().is_empty())
        .collect();
    apps.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(apps)
}

/// Website hosts seen in captured browser context.
#[tauri::command]
pub async fn list_capturable_websites(app: AppHandle) -> Result<Vec<CapturableWebsite>, String> {
    let db = crate::context_db::ContextDb::open(&app).await?;
    let rows = db.distinct_website_hosts().await?;
    Ok(rows
        .into_iter()
        .map(|(host, sample_title)| CapturableWebsite {
            id: host.clone(),
            host,
            sample_title,
        })
        .collect())
}
