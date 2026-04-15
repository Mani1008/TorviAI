use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Serialize, Clone)]
pub struct OAuthCallbackPayload {
    pub token: String,
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

            // Parse: GET /callback?token=XYZ HTTP/1.1
            if let Some(first_line) = request.lines().next() {
                let parts: Vec<&str> = first_line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let path = parts[1];
                    let query = path.find('?').map(|i| &path[i + 1..]).unwrap_or("");

                    let mut token = String::new();
                    for pair in query.split('&') {
                        if let Some((k, v)) = pair.split_once('=') {
                            if k == "token" {
                                // URL-decode the token value
                                token = v.replace("%2B", "+").replace("%3D", "=").replace("%2F", "/");
                            }
                        }
                    }

                    if !token.is_empty() {
                        // Emit to all open windows
                        for label in ["gate", "main", "dashboard"] {
                            if let Some(win) = app.get_webview_window(label) {
                                let _ = win.emit(
                                    "oauth-callback-received",
                                    OAuthCallbackPayload { token: token.clone() },
                                );
                            }
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
