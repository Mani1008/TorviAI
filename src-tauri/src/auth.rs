use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Full percent-decode (RFC 3986): handles all `%XX` sequences and `+` → space.
fn percent_decode(input: &str) -> String {
    let src = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'%' && i + 2 < src.len() {
            let hex = match std::str::from_utf8(&src[i + 1..i + 3]) {
                Ok(s) => s,
                Err(_) => {
                    out.push(src[i]);
                    i += 1;
                    continue;
                }
            };
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        } else if src[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(src[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[derive(Serialize, Clone)]
pub struct OAuthCallbackPayload {
    pub token: String,
    pub user_id: String,
    pub secret: String,
    pub provider: String,
    /// PKCE authorization code (Supabase OAuth)
    pub code: String,
    /// Supabase implicit/hash flow tokens (after JS bridge)
    pub access_token: String,
    pub refresh_token: String,
    /// Reflected state nonce — validated by the gate window against the value
    /// stored in sessionStorage before this callback was initiated.
    pub state: String,
}

fn parse_query_params(query: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(k.to_string(), percent_decode(v));
        }
    }
    map
}

/// Supabase puts tokens in the URL hash (#access_token=…), which HTTP servers never
/// receive. This page reads the hash in the browser and re-requests /callback with
/// tokens in the query string so the local Rust server can forward them to Tauri.
fn supabase_hash_extractor_html(port: u16) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Completing sign-in…</title></head>
<body>
<p style="font-family:system-ui,sans-serif;text-align:center;margin-top:40vh;color:#666">
Completing sign-in…</p>
<script>
(function() {{
  var q = new URLSearchParams(window.location.search);
  var err = q.get('error');
  if (err) {{
    var desc = q.get('error_description') || err;
    document.body.innerHTML = '<p style="font-family:system-ui;text-align:center;color:#c00;padding:2rem">' +
      'Sign-in failed: ' + desc + '<br><br>Add <code>http://127.0.0.1:{port}/callback</code> to Supabase Redirect URLs.</p>';
    return;
  }}
  var provider = q.get('provider') || 'supabase';
  var state = q.get('state') || '';
  var hash = window.location.hash ? window.location.hash.substring(1) : '';
  var h = new URLSearchParams(hash);
  var code = h.get('code') || q.get('code');
  var access = h.get('access_token');
  var refresh = h.get('refresh_token');
  var base = 'http://127.0.0.1:{port}/callback';
  if (code) {{
    window.location.replace(base + '?provider=' + encodeURIComponent(provider) +
      '&state=' + encodeURIComponent(state) + '&code=' + encodeURIComponent(code));
  }} else if (access && refresh) {{
    window.location.replace(base + '?provider=' + encodeURIComponent(provider) +
      '&state=' + encodeURIComponent(state) +
      '&access_token=' + encodeURIComponent(access) +
      '&refresh_token=' + encodeURIComponent(refresh));
  }} else {{
    document.body.innerHTML = '<p style="font-family:system-ui,sans-serif;text-align:center;color:#c00;padding:2rem">Sign-in tokens not found in callback URL.<br>Close this tab and try again.<br><br>Ensure Supabase Redirect URLs includes:<br><code>http://127.0.0.1:{port}/callback</code></p>';
  }}
}})();
</script>
</body>
</html>"#
    )
}

fn success_html() -> &'static str {
    r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#09090f;color:#fff}
.card{text-align:center;padding:2rem 2.5rem;border-radius:1rem;border:1px solid #222;background:#111}
h2{margin:0 0 .5rem;font-size:1.2rem}p{color:#666;margin:0;font-size:.9rem}</style>
</head>
<body><div class="card">
<h2>&#10003; Signed in successfully</h2>
<p>You can close this tab and return to Torvi.</p>
</div></body></html>"#
}

async fn write_html_response(stream: &mut tokio::net::TcpStream, html: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

/// Preferred fixed port for OAuth callbacks so Supabase Redirect URLs can be
/// allowlisted exactly (`http://127.0.0.1:18427/callback`). Falls back to an
/// ephemeral port if this one is busy.
const OAUTH_CALLBACK_PORT: u16 = 18427;

/// Starts a temporary local HTTP server for OAuth redirects.
/// Returns the port number.
///
/// Supports Appwrite (userId+secret), legacy JWT (token), and Supabase
/// (PKCE code or hash tokens bridged via an intermediate HTML page).
#[tauri::command]
pub async fn start_oauth_callback_server(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<u16, String> {
    let label = window.label().to_string();
    if !matches!(label.as_str(), "gate" | "main" | "dashboard") {
        log::warn!(
            "[Auth] start_oauth_callback_server called from unexpected window: {}",
            label
        );
        return Err("Not authorized".to_string());
    }

    let listener = match TcpListener::bind(("127.0.0.1", OAUTH_CALLBACK_PORT)).await {
        Ok(l) => l,
        Err(e) => {
            log::warn!(
                "[Auth] Port {} busy ({e}) — falling back to ephemeral port",
                OAUTH_CALLBACK_PORT
            );
            TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind OAuth callback port: {}", e))?
        }
    };

    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    log::info!("[Auth] OAuth callback server listening on 127.0.0.1:{port}");

    let target_label = label;
    tokio::spawn(async move {
        let deadline = Instant::now() + Duration::from_secs(300);
        let mut emitted = false;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                log::warn!("[Auth] OAuth callback server timed out after 5 min");
                break;
            }

            let accept_result = tokio::time::timeout(remaining, listener.accept()).await;
            let (mut stream, _) = match accept_result {
                Ok(Ok(conn)) => conn,
                Ok(Err(e)) => {
                    log::warn!("[Auth] OAuth callback accept error: {}", e);
                    break;
                }
                Err(_) => {
                    log::warn!("[Auth] OAuth callback server timed out — no callback received");
                    break;
                }
            };

            // Tokens in query string can be large (JWT access_token)
            let mut buf = vec![0u8; 131_072];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);

            let Some(first_line) = request.lines().next() else {
                continue;
            };
            let parts: Vec<&str> = first_line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }
            let path = parts[1].split('#').next().unwrap_or(parts[1]);

            if !path.starts_with("/callback") {
                let reject = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = stream.write_all(reject.as_bytes()).await;
                continue;
            }

            let query = path.find('?').map(|i| &path[i + 1..]).unwrap_or("");
            let params = parse_query_params(query);

            // Supabase error redirect (e.g. flow state / redirect_to allowlist)
            if let Some(err) = params.get("error") {
                let desc = params
                    .get("error_description")
                    .cloned()
                    .unwrap_or_else(|| err.clone());
                log::error!("[Auth] OAuth provider error: {desc}");
                let html = format!(
                    r#"<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:3rem;background:#09090f;color:#fff">
<h2 style="color:#f87171">Sign-in failed</h2>
<p style="color:#aaa">{desc}</p>
<p style="color:#666;font-size:.85rem;margin-top:1.5rem">Check Supabase → Authentication → URL Configuration<br>
Redirect URLs must include <code>http://127.0.0.1:{port}/callback</code></p>
<p style="color:#666">Close this tab and try again in Torvi.</p>
</body></html>"#,
                    desc = html_escape(&desc),
                    port = port
                );
                write_html_response(&mut stream, &html).await;
                continue;
            }

            let token = params.get("token").cloned().unwrap_or_default();
            let user_id = params.get("userId").cloned().unwrap_or_default();
            let secret = params.get("secret").cloned().unwrap_or_default();
            let provider = params.get("provider").cloned().unwrap_or_default();
            let mut code = params.get("code").cloned().unwrap_or_default();
            let access_token = params.get("access_token").cloned().unwrap_or_default();
            let refresh_token = params.get("refresh_token").cloned().unwrap_or_default();
            let state = params.get("state").cloned().unwrap_or_default();

            if code.is_empty() && provider == "supabase" && !token.is_empty() {
                code = token.clone();
            }

            let has_data = !code.is_empty()
                || (!access_token.is_empty() && !refresh_token.is_empty())
                || !token.is_empty()
                || (!user_id.is_empty() && !secret.is_empty());

            if has_data && !emitted {
                let payload = OAuthCallbackPayload {
                    token: token.clone(),
                    user_id: user_id.clone(),
                    secret: secret.clone(),
                    provider: if provider.is_empty() {
                        "supabase".into()
                    } else {
                        provider.clone()
                    },
                    code: code.clone(),
                    access_token: access_token.clone(),
                    refresh_token: refresh_token.clone(),
                    state: state.clone(),
                };
                if let Some(win) = app.get_webview_window(&target_label) {
                    let _ = win.emit("oauth-callback-received", payload);
                    emitted = true;
                    log::info!("[Auth] OAuth callback emitted to window '{}'", target_label);
                }
                write_html_response(&mut stream, success_html()).await;
                break;
            }

            // First hop: tokens may live in the URL hash (implicit) or code in
            // query after JS reads hash — serve the bridge page whenever we
            // don't yet have credentials.
            let html = supabase_hash_extractor_html(port);
            write_html_response(&mut stream, &html).await;
            // Keep listening for the follow-up request from the bridge script
        }
    });

    Ok(port)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
