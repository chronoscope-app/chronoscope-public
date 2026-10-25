use std::{path::PathBuf, process::Command};
fn main() {
    println!("cargo:rerun-if-changed=Recording.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    assert!(
        Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-whole-module-optimization",
                "-emit-library",
                "-static",
                "-parse-as-library",
                "-module-name",
                "ChronoscopeRecording",
                "-target",
                &format!("{arch}-apple-macosx11.0"),
                "Recording.swift",
                "-o"
            ])
            .arg(out.join("libChronoscopeRecording.a"))
            .status()
            .expect("Swift compiler required")
            .success(),
        "Window recording bridge failed to compile"
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=ChronoscopeRecording");
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    let developer = String::from_utf8(
        Command::new("xcode-select")
            .arg("-p")
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    println!("cargo:rustc-link-search=native={}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx", developer.trim());
    for framework in ["ScreenCaptureKit", "AVFoundation", "CoreMedia", "CoreVideo"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
