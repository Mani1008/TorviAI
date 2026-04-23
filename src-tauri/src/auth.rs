use serde::Serialize;
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
                Err(_) => { out.push(src[i]); i += 1; continue; }
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
    /// Reflected state nonce — validated by the gate window against the value
    /// stored in sessionStorage before this callback was initiated.
    pub state: String,
}

/// Starts a temporary local HTTP server on a random port.
/// Returns the port number.
///
/// The web app redirects to:  http://127.0.0.1:{port}/callback?token=JWT_OR_SESSION_TOKEN
///
/// On receiving the callback, emits `oauth-callback-received` with the token
/// to all open windows, then responds with a "you can close this tab" page.
#[tauri::command]
pub async fn start_oauth_callback_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind OAuth callback port: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = vec![0u8; 8192];
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);

            // Parse: GET /callback?token=XYZ or /callback?userId=X&secret=Y&provider=appwrite
            if let Some(first_line) = request.lines().next() {
                let parts: Vec<&str> = first_line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let path = parts[1];

                    // Reject requests that are not the expected callback path
                    if !path.starts_with("/callback") {
                        let reject = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                        let _ = stream.write_all(reject.as_bytes()).await;
                        return;
                    }

                    let query = path.find('?').map(|i| &path[i + 1..]).unwrap_or("");

                    let mut token = String::new();
                    let mut user_id = String::new();
                    let mut secret = String::new();
                    let mut provider = String::new();
                    let mut state = String::new();

                    for pair in query.split('&') {
                        if let Some((k, v)) = pair.split_once('=') {
                            // Use full percent-decode (not just 4 chars)
                            let decoded = percent_decode(v);
                            match k {
                                "token" => token = decoded,
                                "userId" => user_id = decoded,
                                "secret" => secret = decoded,
                                "provider" => provider = decoded,
                                "state" => state = decoded,
                                _ => {}
                            }
                        }
                    }

                    let has_data = !token.is_empty() || (!user_id.is_empty() && !secret.is_empty());

                    if has_data {
                        let payload = OAuthCallbackPayload {
                            token: token.clone(),
                            user_id: user_id.clone(),
                            secret: secret.clone(),
                            provider: provider.clone(),
                            state: state.clone(),
                        };
                        // Emit only to the gate window — it owns the OAuth flow.
                        // Other windows (main, dashboard) should not receive auth tokens.
                        if let Some(win) = app.get_webview_window("gate") {
                            let _ = win.emit("oauth-callback-received", payload);
                        }
                    }
                }
            }

            let html = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#09090f;color:#fff}
.card{text-align:center;padding:2rem 2.5rem;border-radius:1rem;border:1px solid #222;background:#111}
h2{margin:0 0 .5rem;font-size:1.2rem}p{color:#666;margin:0;font-size:.9rem}</style>
</head>
<body><div class="card">
<h2>&#10003; Signed in successfully</h2>
<p>You can close this tab and return to Torvi.</p>
</div></body></html>"#;

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });

    Ok(port)
}
