//! Privacy filter for screen context capture.
//!
//! Applied to every `WindowContext` before it is stored or emitted:
//!   1. `should_capture` — drops the whole snapshot for sensitive apps / modes.
//!   2. `redact_sensitive` — strips PII patterns (cards, SSNs, API keys) from text.

use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

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

// ─── PrivacyFilter ────────────────────────────────────────────────────────────

/// Decides whether a captured snapshot should be stored and redacts PII from text.
pub struct PrivacyFilter {
    /// App executable names (lowercase) that must never be captured.
    blocked_apps: HashSet<String>,
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

        Self { blocked_apps }
    }

    /// Returns `false` for contexts that should never be captured:
    /// - App is on the block-list
    /// - Browser is in private / incognito mode (detected via window title)
    pub fn should_capture(&self, ctx: &WindowContext) -> bool {
        let app_lower = ctx.app_name.to_lowercase();

        // Check app block-list (substring match so "keepassxc" matches "keepass")
        if self
            .blocked_apps
            .iter()
            .any(|b| app_lower.contains(b.as_str()))
        {
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
