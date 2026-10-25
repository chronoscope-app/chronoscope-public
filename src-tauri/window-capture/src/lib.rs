//! Platform FFI is isolated here; the desktop and engine forbid unsafe code.
//! Snapshot the WebView itself, never an OS display or another application's pixels.
#![deny(unsafe_op_in_unsafe_fn)]
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
type Reply = Result<Vec<u8>, String>;
type Completion = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Reply>>>>;
const MAX_BYTES: usize = 64 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);

fn finish(completion: &Completion, result: Reply) {
    if let Ok(mut pending) = completion.lock() {
        if let Some(sender) = pending.take() {
            let _ = sender.send(result);
        }
    }
}

pub async fn snapshot(window: tauri::WebviewWindow) -> Reply {
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
        .is_err()
    {
        return Err("RESOURCE_LIMIT: an app screenshot is already in progress".into());
    }
    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::Release);
        }
    }
    let _guard = Guard;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let completion = Arc::new(Mutex::new(Some(sender)));
    let callback = completion.clone();
    window
        .with_webview(move |webview| start(webview, callback))
        .map_err(|e| format!("UNAVAILABLE: native snapshot unavailable ({e})"))?;
    match tokio::time::timeout(std::time::Duration::from_secs(8), receiver).await {
        Ok(Ok(result)) => result,
        _ => {
            // Release the response slot; a late OS callback cannot publish stale pixels.
            completion
                .lock()
                .map_err(|_| "Native snapshot unavailable")?
                .take();
            Err("UNAVAILABLE: native app screenshot timed out".into())
        }
    }
}

#[cfg(target_os = "linux")]
fn start(webview: tauri::webview::PlatformWebview, completion: Completion) {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    webview.inner().snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::NONE,
        None::<&gio::Cancellable>,
        move |result| {
            let result = (|| {
                let surface =
                    result.map_err(|e| format!("UNAVAILABLE: WebKit snapshot failed ({e})"))?;
                let mut bytes = Vec::new();
                surface
                    .write_to_png(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > MAX_BYTES {
                    return Err("RESOURCE_LIMIT: native snapshot exceeds 64 MiB".into());
                }
                Ok(bytes)
            })();
            finish(&completion, result);
        },
    );
}

#[cfg(target_os = "macos")]
fn start(webview: tauri::webview::PlatformWebview, completion: Completion) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    let Some(main) = MainThreadMarker::new() else {
        finish(
            &completion,
            Err("UNAVAILABLE: snapshot requires the main thread".into()),
        );
        return;
    };
    // SAFETY: Tauri supplies its live WKWebView on the UI thread for this closure.
    // The borrowed pointer never escapes; WebKit retains the completion block.
    unsafe {
        let Some(view) = webview.inner().cast::<WKWebView>().as_ref() else {
            finish(&completion, Err("UNAVAILABLE: WebView closed".into()));
            return;
        };
        let configuration = WKSnapshotConfiguration::new(main);
        configuration.setAfterScreenUpdates(true);
        let block = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| {
                if !error.is_null() {
                    return Err("UNAVAILABLE: WebKit app snapshot failed".into());
                }
                // Callback pointers are borrowed for this invocation only.
                let image = image
                    .as_ref()
                    .ok_or("UNAVAILABLE: WebKit returned no image")?;
                let tiff = image
                    .TIFFRepresentation()
                    .ok_or("Native image encoding failed")?;
                let bitmap =
                    NSBitmapImageRep::imageRepWithData(&tiff).ok_or("Native bitmap unavailable")?;
                let png = bitmap
                    .representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                    .ok_or("Native PNG encoding failed")?;
                if png.len() > MAX_BYTES {
                    return Err("RESOURCE_LIMIT: native snapshot exceeds 64 MiB".into());
                }
                Ok(png.to_vec())
            })();
            finish(&completion, result);
        });
        view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &block);
    }
}

#[cfg(target_os = "windows")]
fn start(webview: tauri::webview::PlatformWebview, completion: Completion) {
    use webview2_com::{
        CapturePreviewCompletedHandler,
        Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::{
        System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET},
        UI::Shell::SHCreateMemStream,
    };
    // SAFETY: all COM objects remain on Tauri's WebView2 UI thread. The stream is
    // retained by the completion closure and bounded before allocating/readback.
    unsafe {
        let result = (|| -> Result<(), String> {
            let stream = SHCreateMemStream(None).ok_or("Native screenshot stream unavailable")?;
            let output = stream.clone();
            let callback = completion.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                let result = (|| -> Reply {
                    status.map_err(|e| format!("UNAVAILABLE: WebView2 snapshot failed ({e})"))?;
                    let mut stat = STATSTG::default();
                    output
                        .Stat(&mut stat, STATFLAG_NONAME)
                        .map_err(|e| e.to_string())?;
                    if stat.cbSize == 0 || stat.cbSize > MAX_BYTES as u64 {
                        return Err(
                            "RESOURCE_LIMIT: native snapshot is empty or exceeds 64 MiB".into()
                        );
                    }
                    output
                        .Seek(0, STREAM_SEEK_SET, None)
                        .map_err(|e| e.to_string())?;
                    let mut bytes = vec![0; stat.cbSize as usize];
                    let mut read = 0;
                    output
                        .Read(
                            bytes.as_mut_ptr().cast(),
                            bytes.len() as u32,
                            Some(&mut read),
                        )
                        .ok()
                        .map_err(|e| e.to_string())?;
                    if read as usize != bytes.len() {
                        return Err("OPERATION_FAILED: incomplete native PNG".into());
                    }
                    Ok(bytes)
                })();
                finish(&callback, result);
                Ok(())
            }));
            let view = webview
                .controller()
                .CoreWebView2()
                .map_err(|e| e.to_string())?;
            view.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            finish(&completion, Err(error));
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn start(_: tauri::webview::PlatformWebview, completion: Completion) {
    finish(
        &completion,
        Err("UNAVAILABLE: native app screenshots unsupported on this platform".into()),
    );
}

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
