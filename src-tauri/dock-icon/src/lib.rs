//! Keep AppKit FFI outside the desktop executable, which forbids unsafe code.
#![deny(unsafe_op_in_unsafe_fn)]

/// Change only this running application's Dock icon, on AppKit's main thread.
#[cfg(target_os = "macos")]
pub fn set_image(png: &[u8]) -> Result<(), &'static str> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let main = MainThreadMarker::new().ok_or("Dock icon requires the main thread")?;
    let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(png))
        .ok_or("Dock icon could not be decoded")?;
    let app = NSApplication::sharedApplication(main);
    // SAFETY: AppKit's setter only requires a non-null NSImage. The decoded,
    // retained image is alive for this main-thread call; AppKit retains it.
    unsafe { app.setApplicationIconImage(Some(&image)) };
    Ok(())
}
