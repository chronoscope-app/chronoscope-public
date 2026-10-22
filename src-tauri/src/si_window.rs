//! Only the fixed local SI page can be opened; it shares the existing engine.
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
#[tauri::command]
// Async IPC avoids WebView2 deadlock when a command creates a native window.
pub async fn si_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
) -> Result<Value, String> {
    if !matches!(window.label(), "main" | "si-chat") {
        return Err("SI window operation unavailable".into());
    }
    match action.as_str() {
        "status" => Ok(json!({"open":app.get_webview_window("si-chat").is_some()})),
        "open" | "focus" => {
            if let Some(chat) = app.get_webview_window("si-chat") {
                chat.show().map_err(|e| e.to_string())?;
                chat.unminimize().map_err(|e| e.to_string())?;
                chat.set_focus().map_err(|e| e.to_string())?;
            } else if action == "open" {
                let dev = if cfg!(debug_assertions) {
                    app.config()
                        .build
                        .dev_url
                        .as_ref()
                        .and_then(|u| u.join("si.html").ok())
                } else {
                    None
                };
                tauri::WebviewWindowBuilder::new(
                    &app,
                    "si-chat",
                    tauri::WebviewUrl::App("si.html".into()),
                )
                .title("SI — Chronoscope")
                .inner_size(860., 900.)
                .min_inner_size(480., 460.)
                .on_navigation(move |url| {
                    // System-browser links are handled separately; this WebView
                    // remains on the bundled local chat page for its lifetime.
                    dev.as_ref() == Some(url)
                        || (url.path() == "/si.html"
                            && url.query().is_none()
                            && url.fragment().is_none()
                            && url.port().is_none()
                            && (url.scheme() == "tauri" && url.host_str() == Some("localhost")
                                || matches!(url.scheme(), "http" | "https")
                                    && url.host_str() == Some("tauri.localhost")))
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()
                .map_err(|e| e.to_string())?;
                let _ = app.emit_to("main", "si-window-opened", ());
            }
            Ok(json!({"open":app.get_webview_window("si-chat").is_some()}))
        }
        "dock" => {
            if let Some(chat) = app.get_webview_window("si-chat") {
                // The chat already flushes its draft before invoking this command.
                // close() would re-enter its onCloseRequested handler; destroy it
                // here so neither docking nor the native close button needs a
                // second, frontend window-destroy permission.
                chat.destroy().map_err(|e| e.to_string())?;
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
            Ok(json!({"open":false}))
        }
        _ => Err("Unknown SI window action".into()),
    }
}

#[tauri::command]
pub async fn si_open_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid link")?;
    if url.len() > 4096
        || !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only HTTP(S) source links are supported".into());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
