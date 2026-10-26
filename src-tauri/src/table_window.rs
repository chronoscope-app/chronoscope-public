//! Only the fixed local Attribute tables page can be opened; it shares the existing engine.
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
#[tauri::command]
// Async IPC avoids WebView2 deadlock when a command creates a native window.
pub async fn table_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
) -> Result<Value, String> {
    if !matches!(window.label(), "main" | "attribute-tables") {
        return Err("Attribute tables window operation unavailable".into());
    }
    match action.as_str() {
        "status" => Ok(json!({"open":app.get_webview_window("attribute-tables").is_some()})),
        "open" | "focus" => {
            if let Some(table) = app.get_webview_window("attribute-tables") {
                table.show().map_err(|e| e.to_string())?;
                table.unminimize().map_err(|e| e.to_string())?;
                table.set_focus().map_err(|e| e.to_string())?;
            } else if action == "open" {
                let dev = if cfg!(debug_assertions) {
                    app.config()
                        .build
                        .dev_url
                        .as_ref()
                        .and_then(|u| u.join("tables.html").ok())
                } else {
                    None
                };
                tauri::WebviewWindowBuilder::new(
                    &app,
                    "attribute-tables",
                    tauri::WebviewUrl::App("tables.html".into()),
                )
                .title(format!(
                    "Attribute tables — Chronoscope {}",
                    app.package_info().version
                ))
                .inner_size(1100., 600.)
                .min_inner_size(640., 260.)
                .on_navigation(move |url| {
                    // System-browser links are handled separately; this WebView
                    // remains on the bundled local table page for its lifetime.
                    dev.as_ref() == Some(url)
                        || (url.path() == "/tables.html"
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
                let _ = app.emit_to("main", "table-window-opened", ());
            }
            Ok(json!({"open":app.get_webview_window("attribute-tables").is_some()}))
        }
        "dock" => {
            if let Some(table) = app.get_webview_window("attribute-tables") {
                // Table state is handed back to main before this command.
                // close() would re-enter its onCloseRequested handler; destroy it
                // here so neither docking nor the native close button needs a
                // second, frontend window-destroy permission.
                table.destroy().map_err(|e| e.to_string())?;
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
            }
            Ok(json!({"open":false}))
        }
        _ => Err("Unknown Attribute tables window action".into()),
    }
}
