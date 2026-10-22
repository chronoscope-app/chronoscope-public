fn main() {
    println!("cargo:rerun-if-changed=native/AppleIntelligence.swift");
    println!("cargo:rerun-if-changed=native/WmtsTransport.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        let ai_out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("chronoscope-apple-intelligence");
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-parse-as-library",
                "-swift-version",
                "5",
                "-O",
                "-target",
                &format!("{arch}-apple-macosx11.0"),
                "native/AppleIntelligence.swift",
                "-o",
            ])
            .arg(ai_out)
            .status()
            .expect("Xcode with FoundationModels SDK required");
        assert!(
            status.success(),
            "Apple Intelligence bridge failed to compile"
        );
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("chronoscope-wmts-native");
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-target",
                &format!("{arch}-apple-macosx11.0"),
                "-framework",
                "AppKit",
                "-framework",
                "Security",
                "native/WmtsTransport.swift",
                "-o",
            ])
            .arg(out)
            .status()
            .expect("macOS build requires the Xcode command line Swift compiler");
        assert!(
            status.success(),
            "macOS native WMTS transport failed to compile"
        );
    }
}
