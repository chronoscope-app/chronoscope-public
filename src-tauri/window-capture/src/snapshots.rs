use std::collections::BTreeSet;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

const MAX_BYTES: usize = 64 * 1024 * 1024;

/// Native PNG and measured geometry. No coordinate mapping is inferred here.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub png: Vec<u8>,
    pub geometry: SnapshotGeometry,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SnapshotGeometry {
    /// PNG IHDR dimensions, not window dimensions or CSS viewport dimensions.
    pub pixel_size: [u32; 2],
    /// AppKit/WebKit measurements; None on other platforms.
    pub macos: Option<MacSnapshotGeometry>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnapshotSize {
    pub width: f64,
    pub height: f64,
}

/// Native view rectangle in points, preserving the native coordinate orientation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnapshotRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnapshotInsets {
    pub top: f64,
    pub left: f64,
    pub bottom: f64,
    pub right: f64,
}

/// Measurements copied on the main thread; no native objects escape the callback.
#[derive(Clone, Debug, PartialEq)]
pub struct MacViewGeometry {
    pub bounds: SnapshotRect,
    /// WKWebView frame in its superview's coordinates.
    pub frame: SnapshotRect,
    pub flipped: bool,
    pub safe_area_rect: SnapshotRect,
    pub safe_area_insets: SnapshotInsets,
    /// NSWindow.contentLayoutRect converted from window into WKWebView coordinates.
    /// It is a measured non-obscured-content rect, not assumed to equal the DOM viewport.
    pub window_content_rect_in_view: Option<SnapshotRect>,
    pub backing_scale_factor: Option<f64>,
    pub page_zoom: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MacSnapshotGeometry {
    pub at_request: MacViewGeometry,
    pub at_completion: MacViewGeometry,
    /// Configuration remains the legacy default: null rect means view bounds.
    pub configured_rect: Option<SnapshotRect>,
    pub configured_width_points: Option<f64>,
    pub after_screen_updates: bool,
    pub image_point_size: SnapshotSize,
    pub bitmap_pixel_size: [u32; 2],
}

impl Snapshot {
    fn from_png(png: Vec<u8>, macos: Option<MacSnapshotGeometry>) -> Result<Self, String> {
        if png.len() > MAX_BYTES {
            return Err("RESOURCE_LIMIT: native snapshot exceeds 64 MiB".into());
        }
        let pixel_size = png_dimensions(&png)?;
        Ok(Self {
            png,
            geometry: SnapshotGeometry { pixel_size, macos },
        })
    }
}

fn png_dimensions(bytes: &[u8]) -> Result<[u32; 2], String> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return Err("OPERATION_FAILED: native snapshot returned invalid PNG metadata".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("checked PNG header"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("checked PNG header"));
    if width == 0 || height == 0 {
        return Err("OPERATION_FAILED: native snapshot returned empty PNG dimensions".into());
    }
    Ok([width, height])
}

type Reply = Result<Snapshot, String>;
type Completion = Arc<Pending>;
static ACTIVE: OnceLock<Mutex<BTreeSet<String>>> = OnceLock::new();

struct Permit {
    key: String,
}
impl Permit {
    fn acquire(key: &str) -> Result<Self, String> {
        let mut active = ACTIVE
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "UNAVAILABLE: snapshot admission unavailable")?;
        if !active.insert(key.to_owned()) {
            return Err(
                "RESOURCE_LIMIT: an app screenshot is already in progress for this view".into(),
            );
        }
        Ok(Self {
            key: key.to_owned(),
        })
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.get_or_init(Default::default).lock() {
            active.remove(&self.key);
        }
    }
}

struct Pending {
    permit: Mutex<Option<Permit>>,
    sender: Mutex<Option<tokio::sync::oneshot::Sender<Reply>>>,
    canceled: AtomicBool,
    #[cfg(target_os = "linux")]
    cancellable: gio::Cancellable,
}
impl Pending {
    fn new(key: &str) -> Result<(Completion, tokio::sync::oneshot::Receiver<Reply>), String> {
        let permit = Permit::acquire(key)?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        Ok((
            Arc::new(Self {
                permit: Mutex::new(Some(permit)),
                sender: Mutex::new(Some(sender)),
                canceled: AtomicBool::new(false),
                #[cfg(target_os = "linux")]
                cancellable: gio::Cancellable::new(),
            }),
            receiver,
        ))
    }
    fn cancel(&self) {
        self.canceled.store(true, Ordering::Release);
        if let Ok(mut sender) = self.sender.lock() {
            sender.take();
        }
        #[cfg(target_os = "linux")]
        {
            use gio::prelude::CancellableExt;
            self.cancellable.cancel();
        }
        // Do not release the permit: the callback still owns the native request.
    }
}

fn finish(completion: &Completion, result: Reply) {
    // Native completion/cancel acknowledgement makes a subsequent request safe.
    if let Ok(mut permit) = completion.permit.lock() {
        permit.take();
    }
    if let Ok(mut pending) = completion.sender.lock() {
        if let Some(sender) = pending.take() {
            if !completion.canceled.load(Ordering::Acquire) {
                let _ = sender.send(result);
            }
        }
    }
}

/// Cancels on timeout or future drop while callback ownership keeps admission held.
struct Waiting(Completion);
impl Drop for Waiting {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

/// Existing API: same PNG bytes and snapshot configuration as before.
pub async fn snapshot(window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    snapshot_with_geometry(window)
        .await
        .map(|snapshot| snapshot.png)
}

/// Snapshot the actual WebView and expose measured native geometry for mapping
/// diagnostics. This does not guess a DOM viewport, title-bar inset or DPR.
pub async fn snapshot_with_geometry(window: tauri::WebviewWindow) -> Result<Snapshot, String> {
    let (completion, receiver) = Pending::new(window.label())?;
    let _waiting = Waiting(completion.clone());
    window
        .with_webview(move |webview| {
            if completion.canceled.load(Ordering::Acquire) {
                finish(
                    &completion,
                    Err("UNAVAILABLE: native snapshot canceled before dispatch".into()),
                );
                return;
            }
            start(webview, completion);
        })
        .map_err(|e| format!("UNAVAILABLE: native snapshot unavailable ({e})"))?;
    match tokio::time::timeout(std::time::Duration::from_secs(8), receiver).await {
        Ok(Ok(result)) => result,
        _ => Err("UNAVAILABLE: native app screenshot timed out".into()),
    }
}

#[cfg(any(target_os = "linux", test))]
struct BoundedBytes {
    bytes: Vec<u8>,
    limit: usize,
}
#[cfg(any(target_os = "linux", test))]
impl std::io::Write for BoundedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "native PNG exceeds byte limit",
            ));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn start(webview: tauri::webview::PlatformWebview, completion: Completion) {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    let cancellable = completion.cancellable.clone();
    webview.inner().snapshot(
        SnapshotRegion::Visible,
        // Preserve transparent DOM areas so native scene pixels remain visible.
        // Explicit opaque CSS backgrounds still paint normally.
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        Some(&cancellable),
        move |result| {
            let result = (|| {
                if completion.canceled.load(Ordering::Acquire) {
                    return Err("UNAVAILABLE: native snapshot canceled".into());
                }
                let surface =
                    result.map_err(|e| format!("UNAVAILABLE: WebKit snapshot failed ({e})"))?;
                let mut output = BoundedBytes {
                    bytes: Vec::new(),
                    limit: MAX_BYTES,
                };
                surface
                    .write_to_png(&mut output)
                    .map_err(|e| e.to_string())?;
                Snapshot::from_png(output.bytes, None)
            })();
            finish(&completion, result);
        },
    );
}

#[cfg(target_os = "macos")]
fn mac_geometry(view: &objc2_web_kit::WKWebView) -> MacViewGeometry {
    fn rect(value: objc2_foundation::NSRect) -> SnapshotRect {
        SnapshotRect {
            x: value.origin.x,
            y: value.origin.y,
            width: value.size.width,
            height: value.size.height,
        }
    }
    let window = view.window();
    let insets = view.safeAreaInsets();
    MacViewGeometry {
        bounds: rect(view.bounds()),
        frame: rect(view.frame()),
        flipped: view.isFlipped(),
        safe_area_rect: rect(view.safeAreaRect()),
        safe_area_insets: SnapshotInsets {
            top: insets.top,
            left: insets.left,
            bottom: insets.bottom,
            right: insets.right,
        },
        window_content_rect_in_view: window
            .as_ref()
            .map(|window| rect(view.convertRect_fromView(window.contentLayoutRect(), None))),
        backing_scale_factor: window.as_ref().map(|window| window.backingScaleFactor()),
        // SAFETY: supplied WKWebView is retained and inspected only on the main thread.
        page_zoom: unsafe { view.pageZoom() },
    }
}

#[cfg(target_os = "macos")]
fn start(webview: tauri::webview::PlatformWebview, completion: Completion) {
    use objc2::{
        rc::{Retained, Weak},
        MainThreadMarker,
    };
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
    // SAFETY: Tauri provides its live WKWebView on the UI thread. Borrowing is
    // backed by a local retain; callback lookup is weak to avoid a retain cycle
    // if WebKit holds the block while its view is being closed.
    unsafe {
        let Some(view) = Retained::retain(webview.inner().cast::<WKWebView>()) else {
            finish(&completion, Err("UNAVAILABLE: WebView closed".into()));
            return;
        };
        let at_request = mac_geometry(&view);
        let callback_view = Weak::from_retained(&view);
        let configuration = WKSnapshotConfiguration::new(main);
        // Preserve the existing configuration: default bounds/width and recent paint.
        configuration.setAfterScreenUpdates(true);
        let block = block2::RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| {
                if MainThreadMarker::new().is_none() {
                    return Err("UNAVAILABLE: snapshot completion requires the main thread".into());
                }
                if completion.canceled.load(Ordering::Acquire) {
                    return Err("UNAVAILABLE: native snapshot canceled".into());
                }
                if !error.is_null() {
                    return Err("UNAVAILABLE: WebKit app snapshot failed".into());
                }
                let image = image
                    .as_ref()
                    .ok_or("UNAVAILABLE: WebKit returned no image")?;
                let size = image.size();
                let callback_view = callback_view
                    .load()
                    .ok_or("UNAVAILABLE: WebView closed during snapshot")?;
                let at_completion = mac_geometry(&callback_view);
                let tiff = image
                    .TIFFRepresentation()
                    .ok_or("Native image encoding failed")?;
                let bitmap =
                    NSBitmapImageRep::imageRepWithData(&tiff).ok_or("Native bitmap unavailable")?;
                let bitmap_pixel_size = [
                    u32::try_from(bitmap.pixelsWide())
                        .map_err(|_| "Native bitmap width invalid")?,
                    u32::try_from(bitmap.pixelsHigh())
                        .map_err(|_| "Native bitmap height invalid")?,
                ];
                let png = bitmap
                    .representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                    .ok_or("Native PNG encoding failed")?;
                if png.len() > MAX_BYTES {
                    return Err("RESOURCE_LIMIT: native snapshot exceeds 64 MiB".into());
                }
                Snapshot::from_png(
                    png.to_vec(),
                    Some(MacSnapshotGeometry {
                        at_request: at_request.clone(),
                        at_completion,
                        configured_rect: None,
                        configured_width_points: None,
                        after_screen_updates: true,
                        image_point_size: SnapshotSize {
                            width: size.width,
                            height: size.height,
                        },
                        bitmap_pixel_size,
                    }),
                )
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
    // SAFETY: COM/controller/stream stay on the WebView2 UI thread. The callback
    // owns admission until completion; CapturePreview has no cancellation API.
    unsafe {
        let result = (|| -> Result<(), String> {
            let stream = SHCreateMemStream(None).ok_or("Native screenshot stream unavailable")?;
            let output = stream.clone();
            let callback = completion.clone();
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                let result = (|| -> Reply {
                    if callback.canceled.load(Ordering::Acquire) {
                        return Err("UNAVAILABLE: native snapshot canceled".into());
                    }
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
                    Snapshot::from_png(bytes, None)
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

#[cfg(test)]
mod tests {
    use super::*;
    fn header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }
    #[test]
    fn png_dimensions_come_from_image_not_assumed_css_or_window_scale() {
        let png = header(3200, 2000);
        let snapshot = Snapshot::from_png(png.clone(), None).unwrap();
        assert_eq!(snapshot.png, png);
        assert_eq!(snapshot.geometry.pixel_size, [3200, 2000]);
        assert!(snapshot.geometry.macos.is_none());
        for bytes in [
            vec![],
            header(0, 2000),
            header(3200, 0),
            b"not a PNG".to_vec(),
        ] {
            assert!(Snapshot::from_png(bytes, None).is_err());
        }
    }
    #[test]
    fn copied_metadata_is_send_sync_and_keeps_native_coordinate_orientation() {
        fn send_sync<T: Send + Sync>() {}
        send_sync::<Snapshot>();
        let before = MacViewGeometry {
            bounds: SnapshotRect {
                x: 0.0,
                y: 0.0,
                width: 1600.0,
                height: 1000.0,
            },
            frame: SnapshotRect {
                x: 4.0,
                y: 7.0,
                width: 1600.0,
                height: 1000.0,
            },
            flipped: true,
            safe_area_rect: SnapshotRect {
                x: 0.0,
                y: 24.0,
                width: 1600.0,
                height: 976.0,
            },
            safe_area_insets: SnapshotInsets {
                top: 24.0,
                left: 0.0,
                bottom: 0.0,
                right: 0.0,
            },
            window_content_rect_in_view: None,
            backing_scale_factor: Some(2.0),
            page_zoom: 1.25,
        };
        let mut after = before.clone();
        after.bounds.height = 900.0;
        let metadata = MacSnapshotGeometry {
            at_request: before.clone(),
            at_completion: after.clone(),
            configured_rect: None,
            configured_width_points: None,
            after_screen_updates: true,
            image_point_size: SnapshotSize {
                width: 1600.0,
                height: 1000.0,
            },
            bitmap_pixel_size: [3200, 2000],
        };
        let snapshot = Snapshot::from_png(header(3200, 2000), Some(metadata)).unwrap();
        let actual = snapshot.geometry.macos.unwrap();
        assert_eq!(actual.at_request, before);
        assert_eq!(actual.at_completion, after);
        assert_ne!(actual.at_request.bounds, actual.at_completion.bounds);
        assert_eq!(actual.image_point_size.height, 1000.0);
        assert_eq!(actual.bitmap_pixel_size, snapshot.geometry.pixel_size);
    }
    #[test]
    fn caller_drop_cancels_reply_but_keeps_view_busy_until_native_acknowledges() {
        let (pending, mut receiver) = Pending::new("cancel-then-ack").unwrap();
        let waiter = Waiting(pending.clone());
        let callback = pending.clone();
        drop(pending);
        drop(waiter); // Same Drop path as timeout or canceled snapshot future.
        assert!(callback.canceled.load(Ordering::Acquire));
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
        assert!(Pending::new("cancel-then-ack").is_err());
        assert!(Pending::new("independent-view").is_ok());
        // Late completion cannot return pixels to the canceled caller.
        finish(&callback, Snapshot::from_png(header(1, 1), None));
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
        assert!(Pending::new("cancel-then-ack").is_ok());
    }
    #[test]
    fn native_callback_destruction_releases_quarantine_without_leaking_admission() {
        let (pending, _receiver) = Pending::new("callback-destroyed").unwrap();
        let waiter = Waiting(pending.clone());
        let callback = pending.clone();
        drop(pending);
        drop(waiter);
        assert!(Pending::new("callback-destroyed").is_err());
        drop(callback); // Native operation/callback destroyed with its WebView.
        assert!(Pending::new("callback-destroyed").is_ok());
    }
    #[test]
    fn successful_callback_delivers_once_and_releases_only_its_view() {
        let (pending, mut receiver) = Pending::new("normal-completion").unwrap();
        let (other, _other_receiver) = Pending::new("other-active-view").unwrap();
        let _waiter = Waiting(pending.clone());
        let pixels = header(3, 2);
        finish(&pending, Snapshot::from_png(pixels.clone(), None));
        finish(&pending, Err("duplicate completion".into()));
        assert_eq!(receiver.try_recv().unwrap().unwrap().png, pixels);
        assert!(Pending::new("normal-completion").is_ok());
        assert!(Pending::new("other-active-view").is_err());
        finish(&other, Err("native failure".into()));
        assert!(Pending::new("other-active-view").is_ok());
    }
    #[test]
    fn png_writer_rejects_growth_before_exceeding_the_bound() {
        use std::io::Write;
        let mut output = BoundedBytes {
            bytes: Vec::new(),
            limit: 4,
        };
        output.write_all(&[1, 2, 3]).unwrap();
        assert!(output.write_all(&[4, 5]).is_err());
        assert_eq!(output.bytes, [1, 2, 3]);
        output.write_all(&[4]).unwrap();
        assert_eq!(output.bytes, [1, 2, 3, 4]);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_cancellation_reaches_the_gio_operation() {
        use gio::prelude::CancellableExt;
        let (pending, _receiver) = Pending::new("gio-cancel").unwrap();
        assert!(!pending.cancellable.is_cancelled());
        pending.cancel();
        assert!(pending.cancellable.is_cancelled());
        assert!(Pending::new("gio-cancel").is_err());
        finish(&pending, Err("GIO canceled acknowledgement".into()));
        assert!(Pending::new("gio-cancel").is_ok());
    }
}
