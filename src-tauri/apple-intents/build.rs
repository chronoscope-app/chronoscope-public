use std::{path::PathBuf, process::Command};
fn run(command: &mut Command) {
    assert!(
        command.status().expect("Xcode tool missing").success(),
        "App Intents build failed"
    );
}
fn main() {
    println!("cargo:rerun-if-changed=Intents.swift");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let arch = if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let target = format!("{arch}-apple-macosx11.0");
    let source = std::env::current_dir().unwrap().join("Intents.swift");
    let protocols = out.join("protocols.json");
    std::fs::write(
        &protocols,
        r#"["AppIntent","AppEntity","AppEnum","AppShortcutsProvider","AppIntentsPackage"]"#,
    )
    .unwrap();
    let values = out.join("Intents.swiftconstvalues");
    let library = out.join("libChronoscopeIntents.a");
    run(Command::new("xcrun")
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
            "ChronoscopeIntents",
            "-target",
            &target,
            "-Xfrontend",
            "-const-gather-protocols-file",
        ])
        .arg("-Xfrontend")
        .arg(&protocols)
        .arg("-emit-const-values-path")
        .arg(&values)
        .arg(&source)
        .arg("-o")
        .arg(&library));
    let sources = out.join("sources.txt");
    std::fs::write(&sources, format!("{}\n", source.display())).unwrap();
    let consts = out.join("consts.txt");
    std::fs::write(&consts, format!("{}\n", values.display())).unwrap();
    let xcode = String::from_utf8(
        Command::new("xcode-select")
            .arg("-p")
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let sdk = String::from_utf8(
        Command::new("xcrun")
            .args(["--sdk", "macosx", "--show-sdk-path"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let version = Command::new("xcodebuild")
        .arg("-version")
        .output()
        .expect("Xcode required");
    let version = String::from_utf8(version.stdout).unwrap();
    let xcode_build = version
        .lines()
        .find_map(|line| line.strip_prefix("Build version "))
        .expect("Xcode build version missing");
    let metadata = out.join("metadata");
    std::fs::create_dir_all(&metadata).unwrap();
    run(Command::new("xcrun")
        .arg("appintentsmetadataprocessor")
        .arg("--output")
        .arg(&metadata)
        .arg("--toolchain-dir")
        .arg(format!(
            "{}/Toolchains/XcodeDefault.xctoolchain",
            xcode.trim()
        ))
        .args([
            "--module-name",
            "ChronoscopeIntents",
            "--sdk-root",
            sdk.trim(),
            "--xcode-version",
            xcode_build,
            "--platform-family",
            "macOS",
            "--deployment-target",
            "11.0",
            "--target-triple",
            &target,
            "--source-file-list",
        ])
        .arg(sources)
        .arg("--swift-const-vals-list")
        .arg(consts)
        .arg("--no-app-shortcuts-localization"));
    println!(
        "cargo:metadata_path={}",
        metadata.join("Metadata.appintents").display()
    );

    // Force-load must propagate to consumers; link-lib plus link modifier keeps Swift intent metadata.
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static:+whole-archive=ChronoscopeIntents");
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-search=native={}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",xcode.trim());
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    println!("cargo:rustc-link-lib=framework=Foundation");
}
