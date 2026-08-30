//! One-shot loopback HTTP server for provider OAuth (PKCE) callbacks.
//!
//! Bind first ([`prepare_loopback`]), build the auth URL with the returned
//! `redirect_uri`, then [`PreparedLoopback::listen`] with the CSRF state from
//! that auth URL. Distinct from [`crate::auth::start_oauth_callback_server`].

use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const TIMEOUT: Duration = Duration::from_secs(300);

/// Bound listener waiting for CSRF state + accept loop.
pub struct PreparedLoopback {
    pub redirect_uri: String,
    pub port: u16,
    listener: TcpListener,
}

impl PreparedLoopback {
    /// Start accepting callbacks. `expected_state` must match the auth URL `state`.
    pub fn listen(self, expected_state: String) -> Result<LoopbackSession, String> {
        if expected_state.trim().is_empty() {
            return Err("expected_state must not be empty".into());
        }

        let PreparedLoopback {
            redirect_uri,
            port,
            listener,
        } = self;

        let (code_tx, code_rx) = oneshot::channel::<Result<String, String>>();
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

        log::info!("[Integrations] OAuth loopback listening on {redirect_uri}");

        tokio::spawn(async move {
            run_loopback(listener, port, expected_state, code_tx, cancel_rx).await;
        });

        Ok(LoopbackSession {
            redirect_uri,
            port,
            code_rx: Some(code_rx),
            cancel_tx: Some(cancel_tx),
        })
    }
}

/// Active loopback wait — drop or call [`LoopbackSession::cancel`] to abort.
pub struct LoopbackSession {
    pub redirect_uri: String,
    pub port: u16,
    code_rx: Option<oneshot::Receiver<Result<String, String>>>,
    cancel_tx: Option<oneshot::Sender<()>>,
}

impl LoopbackSession {
    /// Wait for the authorization `code` (or error / timeout / cancel).
    pub async fn wait_for_code(mut self) -> Result<String, String> {
        let rx = self
            .code_rx
            .take()
            .ok_or_else(|| "Loopback session already consumed".to_string())?;
        let result = rx
            .await
            .map_err(|_| "Loopback server task ended unexpectedly".to_string())?;
        self.cancel_tx.take();
        result
    }

    /// Move the cancel sender out so a second connect can abort this session.
    pub fn take_cancel_tx(&mut self) -> Option<oneshot::Sender<()>> {
        self.cancel_tx.take()
    }

    /// Abort the in-flight listener.
    pub fn cancel(&mut self) {
        if let Some(tx) = self.cancel_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for LoopbackSession {
    fn drop(&mut self) {
        if let Some(tx) = self.cancel_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Bind `127.0.0.1:0` and return the redirect URI (before spawning the accept loop).
pub async fn prepare_loopback() -> Result<PreparedLoopback, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind integration OAuth loopback: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    Ok(PreparedLoopback {
        redirect_uri,
        port,
        listener,
    })
}

async fn run_loopback(
    listener: TcpListener,
    port: u16,
    expected_state: String,
    code_tx: oneshot::Sender<Result<String, String>>,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let deadline = Instant::now() + TIMEOUT;
    let mut code_tx = Some(code_tx);

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            log::warn!("[Integrations] OAuth loopback timed out after 5 min");
            if let Some(tx) = code_tx.take() {
                let _ = tx.send(Err("OAuth timed out — no callback received".into()));
            }
            return;
        }

        let accept = tokio::select! {
            biased;
            _ = &mut cancel_rx => {
                log::info!("[Integrations] OAuth loopback cancelled");
                if let Some(tx) = code_tx.take() {
                    let _ = tx.send(Err("OAuth connect cancelled".into()));
                }
                return;
            }
            result = tokio::time::timeout(remaining, listener.accept()) => result,
        };

        let (mut stream, _) = match accept {
            Ok(Ok(conn)) => conn,
            Ok(Err(e)) => {
                log::warn!("[Integrations] Loopback accept error: {e}");
                if let Some(tx) = code_tx.take() {
                    let _ = tx.send(Err(format!("Loopback accept error: {e}")));
                }
                return;
            }
            Err(_) => {
                log::warn!("[Integrations] OAuth loopback timed out — no callback received");
                if let Some(tx) = code_tx.take() {
                    let _ = tx.send(Err("OAuth timed out — no callback received".into()));
                }
                return;
            }
        };

        let mut buf = vec![0u8; 65_536];
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
            let reject =
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(reject.as_bytes()).await;
            continue;
        }

        let query = path.find('?').map(|i| &path[i + 1..]).unwrap_or("");
        let params = parse_query_params(query);

        if let Some(err) = params.get("error") {
            let desc = params
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| err.clone());
            log::error!("[Integrations] OAuth provider error: {desc}");
            write_html_response(&mut stream, &error_html(&desc, port)).await;
            if let Some(tx) = code_tx.take() {
                let _ = tx.send(Err(format!("OAuth provider error: {desc}")));
            }
            return;
        }

        let state = params.get("state").cloned().unwrap_or_default();
        if state != expected_state {
            log::warn!(
                "[Integrations] CSRF state mismatch (got len={}, expected len={})",
                state.len(),
                expected_state.len()
            );
            write_html_response(
                &mut stream,
                &error_html(
                    "Invalid OAuth state. Close this tab and try again in Torvi.",
                    port,
                ),
            )
            .await;
            continue;
        }

        let code = params.get("code").cloned().unwrap_or_default();
        if code.is_empty() {
            write_html_response(
                &mut stream,
                &error_html(
                    "Missing authorization code. Close this tab and try again.",
                    port,
                ),
            )
            .await;
            continue;
        }

        write_html_response(&mut stream, success_html()).await;
        log::info!("[Integrations] OAuth callback received (code captured, state OK)");
        if let Some(tx) = code_tx.take() {
            let _ = tx.send(Ok(code));
        }
        return;
    }
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let val = kv.next().unwrap_or("");
        if !key.is_empty() {
            map.insert(percent_decode(key), percent_decode(val));
        }
    }
    map
}

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

async fn write_html_response(stream: &mut TcpStream, html: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

fn success_html() -> &'static str {
    r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;background:#fafafa;color:#171717">
  <h2 style="margin:0 0 .5rem">You're connected</h2>
  <p style="color:#737373">You can close this tab and return to Torvi.</p>
</body></html>"#
}

fn error_html(message: &str, port: u16) -> String {
    let safe = html_escape(message);
    format!(
        r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Connection failed</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem;background:#fafafa;color:#171717">
  <h2 style="color:#b91c1c;margin:0 0 .5rem">Connection failed</h2>
  <p style="color:#525252">{safe}</p>
  <p style="color:#a3a3a3;font-size:.85rem;margin-top:1.5rem">Callback port: 127.0.0.1:{port}</p>
  <p style="color:#a3a3a3">Close this tab and try again in Torvi.</p>
</body></html>"#
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
