fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,AppIntents");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        // Rust drops unused dylibs; retain this public Swift cross-import overlay
        // for its AppKit intent handoff initializer, while allowing older macOS.
        println!("cargo:rustc-link-arg=-Wl,-needed_framework,_AppIntents_AppKit");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,_AppIntents_AppKit");
    }
    if let Some(path) = std::env::var_os("DEP_CHRONOSCOPEINTENTS_METADATA_PATH") {
        let destination = std::path::PathBuf::from("resources/Metadata.appintents");
        std::fs::create_dir_all(&destination).unwrap();
        for item in std::fs::read_dir(path).unwrap() {
            let item = item.unwrap();
            let target = destination.join(item.file_name());
            let bytes = std::fs::read(item.path()).unwrap();
            if std::fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                std::fs::write(target, bytes).unwrap();
            }
        }
    }
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app-manifest.xml")),
    );
    tauri_build::try_build(attributes).expect("Desktop build setup failed");
}
