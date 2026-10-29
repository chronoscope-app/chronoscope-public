//! Platform FFI is isolated here; the desktop and engine forbid unsafe code.
//! Snapshot the WebView itself, never an OS display or another application's pixels.
#![deny(unsafe_op_in_unsafe_fn)]
mod snapshots;
pub use snapshots::{
    snapshot, snapshot_with_geometry, MacSnapshotGeometry, MacViewGeometry, Snapshot,
    SnapshotGeometry, SnapshotInsets, SnapshotRect, SnapshotSize,
};

/// A single app-window recording. Platform details and C ABI stay in this crate.
pub async fn recording(
    window: tauri::WebviewWindow,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    recording_platform(window, args).await
}
#[cfg(not(target_os = "macos"))]
async fn recording_platform(
    _: tauri::WebviewWindow,
    _: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err("UNAVAILABLE: native video recording currently requires macOS 15 or later".into())
}
#[cfg(target_os = "macos")]
async fn recording_platform(
    window: tauri::WebviewWindow,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        time::Duration,
    };
    type Sender = tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>;
    unsafe extern "C" {
        fn chronoscope_recording_request(
            view: *mut c_void,
            json: *const c_char,
            callback: extern "C" fn(*mut c_void, *const c_char),
            context: *mut c_void,
        );
    }
    extern "C" fn reply(context: *mut c_void, json: *const c_char) {
        // SAFETY: Swift invokes this once. Both pointers remain valid during this
        // callback; copying JSON precedes the temporary Swift string's release.
        let sender = unsafe { Box::from_raw(context.cast::<Sender>()) };
        let value = unsafe { CStr::from_ptr(json) }
            .to_str()
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).map_err(|e| e.to_string()));
        let result = value.and_then(|v| {
            if v.get("state").is_none() {
                Err(v["error"]
                    .as_str()
                    .unwrap_or("Invalid video bridge response")
                    .into())
            } else {
                Ok(v)
            }
        });
        let _ = sender.send(result);
    }
    let json = CString::new(args.to_string()).map_err(|e| e.to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |webview| {
            // SAFETY: Tauri provides its live WKWebView on the UI thread. Swift
            // copies the request and window number synchronously, retaining no view
            // pointer. The boxed sender is owned by the exactly-once callback.
            unsafe {
                chronoscope_recording_request(
                    webview.inner().cast(),
                    json.as_ptr(),
                    reply,
                    Box::into_raw(Box::new(sender)).cast(),
                );
            }
        })
        .map_err(|e| format!("UNAVAILABLE: recording window unavailable ({e})"))?;
    tokio::time::timeout(Duration::from_secs(12), receiver)
        .await
        .map_err(|_| {
            "UNAVAILABLE: video request timed out; inspect recording status before retrying"
                .to_string()
        })?
        .map_err(|_| "UNAVAILABLE: video bridge disconnected".to_string())?
}
