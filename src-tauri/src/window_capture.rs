//! Fixed app WebView snapshots; never capture a screen or arbitrary window.
use base64::Engine as _;
use tauri::Manager;

#[tauri::command]
pub async fn capture_app_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    label: String,
) -> Result<String, String> {
    if window.label() != "main" || !matches!(label.as_str(), "main" | "si-chat") {
        return Err("INVALID_ARGUMENT: unsupported capture window".into());
    }
    let target = app
        .get_webview_window(&label)
        .ok_or("UNAVAILABLE: requested app window is not open")?;
    if !target.is_visible().map_err(|e| e.to_string())?
        || target.is_minimized().map_err(|e| e.to_string())?
    {
        return Err("UNAVAILABLE: requested app window must be visible and not minimized".into());
    }
    let size = target.inner_size().map_err(|e| e.to_string())?;
    if size.width == 0
        || size.height == 0
        || u64::from(size.width) * u64::from(size.height) > 32_000_000
    {
        return Err(
            "RESOURCE_LIMIT: capture window exceeds 32 million pixels; resize it first".into(),
        );
    }
    let bytes = chronoscope_window_capture::snapshot(target).await?;
    let png =
        tauri::async_runtime::spawn_blocking(move || chronoscope::capture::normalize_png(&bytes))
            .await
            .map_err(|e| format!("OPERATION_FAILED: screenshot encoding failed ({e})"))??;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}
