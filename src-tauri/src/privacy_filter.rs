//! Privacy filter for screen context capture.
//!
//! Applied to every `WindowContext` before it is stored or emitted:
//!   1. `should_capture` — drops the whole snapshot for sensitive apps / modes.
//!   2. `redact_sensitive` — strips PII patterns (cards, SSNs, API keys) from text.

use regex::Regex;
use std::collections::HashSet;
use std::sync::{Arc, OnceLock, RwLock};
use tauri::State;

use crate::screen_reader::WindowContext;

// ─── Regex helpers (compiled once) ───────────────────────────────────────────

fn cc_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b").unwrap()
    })
}

fn ssn_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap())
}

fn api_key_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Common API key prefixes: OpenAI sk-/pk-, GitHub ghp_/ghs_, GitLab glpat-,
        // Google AIza, Anthropic sk-ant-, AWS AKIA
        Regex::new(
            r"\b(sk-ant-|sk-|pk-|ghp_|ghs_|glpat-|AIza|AKIA)[A-Za-z0-9_\-]{20,}\b",
        )
        .unwrap()
    })
}

fn otp_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // 6-digit OTP / 2FA codes — standalone digit runs that look like TOTP tokens.
    // Anchored with word boundaries to avoid matching longer numbers.
    RE.get_or_init(|| Regex::new(r"\b\d{6}\b").unwrap())
}

// ─── Normalization helpers ───────────────────────────────────────────────────

fn normalize_app(input: &str) -> String {
    let mut value = input.trim().to_lowercase();
    if value.ends_with(".exe") {
        value.truncate(value.len() - 4);
    }
    value
}

fn normalize_domain(input: &str) -> String {
    let mut value = input.trim().to_lowercase();
    if let Some(rest) = value.strip_prefix("https://") {
        value = rest.to_string();
    } else if let Some(rest) = value.strip_prefix("http://") {
        value = rest.to_string();
    }
    if let Some(rest) = value.strip_prefix("www.") {
        value = rest.to_string();
    }
    value
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_string()
}

fn host_from_url(url: &str) -> String {
    normalize_domain(url)
}

fn domain_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

// ─── PrivacyFilter ────────────────────────────────────────────────────────────

struct PrivacyFilterInner {
    /// App executable names (lowercase) that must never be captured.
    blocked_apps: HashSet<String>,
    /// Window-title / URL fragments for internal architecture docs (lowercase).
    blocked_doc_fragments: Vec<String>,
    user_blocked_apps: RwLock<HashSet<String>>,
    user_blocked_domains: RwLock<HashSet<String>>,
}

/// Decides whether a captured snapshot should be stored and redacts PII from text.
#[derive(Clone)]
pub struct PrivacyFilter {
    inner: Arc<PrivacyFilterInner>,
}

/// Shared Tauri state for the privacy filter (user exclusions are hot-reloaded).
pub struct PrivacyFilterState {
    pub filter: PrivacyFilter,
}

impl Default for PrivacyFilterState {
    fn default() -> Self {
        Self {
            filter: PrivacyFilter::new(),
        }
    }
}

impl PrivacyFilterState {
    pub fn set_user_exclusions(&self, blocked_apps: Vec<String>, blocked_domains: Vec<String>) {
        let apps: HashSet<String> = blocked_apps
            .iter()
            .map(|s| normalize_app(s))
            .filter(|s| !s.is_empty())
            .collect();
        let domains: HashSet<String> = blocked_domains
            .iter()
            .map(|s| normalize_domain(s))
            .filter(|s| !s.is_empty())
            .collect();

        if let Ok(mut guard) = self.filter.inner.user_blocked_apps.write() {
            *guard = apps;
        }
        if let Ok(mut guard) = self.filter.inner.user_blocked_domains.write() {
            *guard = domains;
        }

        let app_count = self
            .filter
            .inner
            .user_blocked_apps
            .read()
            .map(|g| g.len())
            .unwrap_or(0);
        let domain_count = self
            .filter
            .inner
            .user_blocked_domains
            .read()
            .map(|g| g.len())
            .unwrap_or(0);
        log::info!(
            "[PrivacyFilter] User exclusions updated: {app_count} app(s), {domain_count} domain(s)"
        );
    }
}

impl PrivacyFilter {
    /// Create a filter with sensible default block-list.
    pub fn new() -> Self {
        let blocked_apps: HashSet<String> = [
            // ── Torvi AI itself — never capture our own window ──────────────────
            // Prevents circular noise (the AI reading its own context feed).
            // "ai-assistant" = dev binary (Cargo.toml name)
            // "torvi"        = release binary (tauri.conf.json productName)
            "ai-assistant",
            "torvi",
            // ── Password managers ─────────────────────────────────────────────
            "1password",
            "keepass",
            "keepassxc",
            "bitwarden",
            "dashlane",
            "lastpass",
            "enpass",
            "roboform",
            // ── Banking / finance ─────────────────────────────────────────────
            "mint",
            // ── Screen-lock / auth dialogs ────────────────────────────────────
            "credui",
            "consent",
            "logonui",
            // ── Remote Desktop — never capture remote session content ──────────
            "mstsc",
            // ── Windows lock screen ───────────────────────────────────────────
            "lockapp",
            // ── Task Manager — shows process list / credentials in dumps ──────
            "taskmgr",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        // Internal architecture / roadmap docs — never pollute context memory.
        // Keep in sync with src/lib/context-memory/exclusions.ts
        let blocked_doc_fragments: Vec<String> = [
            "company-brain.html",
            "company-brain.md",
            "architecture.html",
            "context-memory.html",
            "context-memory.md",
            "littlebird_architecture",
            "architecture.md",
            "desktop-app-features-roadmap.md",
            "supabase-schema-plan.md",
            "supabase-migration-report.md",
            "context-memory-architecture-review.md",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        Self {
            inner: Arc::new(PrivacyFilterInner {
                blocked_apps,
                blocked_doc_fragments,
                user_blocked_apps: RwLock::new(HashSet::new()),
                user_blocked_domains: RwLock::new(HashSet::new()),
            }),
        }
    }

    fn is_architecture_doc(&self, ctx: &WindowContext) -> bool {
        let title = ctx.window_title.to_lowercase();
        let url = ctx.url.as_deref().unwrap_or("").to_lowercase();
        let combined = format!("{title} {url}");

        if self
            .inner
            .blocked_doc_fragments
            .iter()
            .any(|frag| combined.contains(frag.as_str()))
        {
            return true;
        }

        // Static architecture HTML served from docs/ (e.g. vite dev server).
        if url.contains("/docs/") && url.ends_with(".html") {
            return true;
        }

        false
    }

    fn is_torvi_own_ui(&self, ctx: &WindowContext) -> bool {
        let title = ctx.window_title.to_lowercase();
        let url = ctx.url.as_deref().unwrap_or("").to_lowercase();

        if title.contains("ai assistant - dashboard") || title.contains("ai assistant - torvi") {
            return true;
        }

        const TORVI_HOSTS: &[&str] = &["localhost:1420", "127.0.0.1:1420"];
        const TORVI_ROUTES: &[&str] = &[
            "/context-memory",
            "/dashboard",
            "/settings",
            "/chats",
            "/billing",
            "/shortcuts",
            "/screenshot",
            "/responses",
            "/gate",
            "/dev/supabase-test",
        ];

        if TORVI_HOSTS.iter().any(|h| url.contains(h))
            && TORVI_ROUTES.iter().any(|r| url.contains(r))
        {
            return true;
        }

        let body = ctx.text_content.to_lowercase();
        const UI_MARKERS: &[&str] = &[
            "live feed of what the ai is observing from your screen",
            "cloud second brain",
            "how context memory works",
            "opt-in upload of local context chunks",
            "captured this session",
            "new chat",
            "context active",
        ];
        let hits = UI_MARKERS.iter().filter(|m| body.contains(**m)).count();
        hits >= 3
    }

    fn is_user_excluded(&self, ctx: &WindowContext) -> bool {
        let app_lower = normalize_app(&ctx.app_name);
        if let Ok(user_apps) = self.inner.user_blocked_apps.read() {
            if user_apps
                .iter()
                .any(|blocked| app_lower.contains(blocked) || blocked.contains(&app_lower))
            {
                return true;
            }
        }

        if let Ok(user_domains) = self.inner.user_blocked_domains.read() {
            if let Some(url) = ctx.url.as_deref() {
                let host = host_from_url(url);
                if !host.is_empty()
                    && user_domains
                        .iter()
                        .any(|domain| domain_matches(&host, domain))
                {
                    return true;
                }
            }

            let title_lower = ctx.window_title.to_lowercase();
            if user_domains
                .iter()
                .any(|domain| title_lower.contains(domain.as_str()))
            {
                return true;
            }
        }

        false
    }

    /// Returns `false` for contexts that should never be captured:
    /// - App is on the block-list
    /// - Browser is in private / incognito mode (detected via window title)
    pub fn should_capture(&self, ctx: &WindowContext) -> bool {
        let app_lower = ctx.app_name.to_lowercase();
        let title_lower = ctx.window_title.to_lowercase();

        // Tauri dashboard webview (WebView2) — process name is msedgewebview2, not ai-assistant.
        if app_lower.contains("msedgewebview2") && title_lower.contains("ai assistant") {
            return false;
        }

        // Check app block-list (substring match so "keepassxc" matches "keepass")
        if self
            .inner
            .blocked_apps
            .iter()
            .any(|b| app_lower.contains(b.as_str()))
        {
            return false;
        }

        if self.is_user_excluded(ctx) {
            return false;
        }

        if self.is_architecture_doc(ctx) {
            return false;
        }

        if self.is_torvi_own_ui(ctx) {
            return false;
        }

        // Drop private/incognito browser windows
        let title_lower = ctx.window_title.to_lowercase();
        if title_lower.contains("inprivate")
            || title_lower.contains("incognito")
            || title_lower.contains("private browsing")
        {
            return false;
        }

        true
    }

    /// Replace known PII patterns with redaction placeholders.
    pub fn redact_sensitive(&self, text: &str) -> String {
        let text = cc_regex().replace_all(text, "[REDACTED-CARD]");
        let text = ssn_regex().replace_all(&text, "[REDACTED-SSN]");
        let text = api_key_regex().replace_all(&text, "[REDACTED-KEY]");
        let text = otp_regex().replace_all(&text, "[REDACTED-OTP]");
        text.to_string()
    }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Update user-defined app and domain exclusions (hot-reloaded by the watcher).
#[tauri::command]
pub fn set_capture_exclusions(
    state: State<'_, PrivacyFilterState>,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
) {
    state.set_user_exclusions(blocked_apps, blocked_domains);
}
