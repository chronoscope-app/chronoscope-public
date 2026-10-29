# Installation and preview status

Current desktop downloads are the [0.16.9 experimental preview](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.9) for Windows x64 and Apple Silicon macOS. Windows was built from `19b4587994bb08083d4693e10e0df2d2f0bfc3f4`; macOS from `c5c532749397edbfc8b023fd1171fa0ac2a46d14`. Application code, assets and dependency locks are byte-identical; the later commit repairs the notice validator and its tests. Exact source archives for both builds and matching dependency sources/notices are attached to the same release.

This preview includes automatic memory/graphics budgets, continuous Fade, clearer light-mode markers, idle CPU improvements and 175 flights across six airports over seven days. See the [changelog](../CHANGELOG.md) and [release-specific validation](validation/release-0.16.9-publication/README.md).

## Preview downloads

| Platform | Download | Installation and trust status |
| --- | --- | --- |
| Windows x64 | [ZIP with current-user installer](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.9/chronoscope-windows-x86_64.zip) | Extract the complete ZIP and run its installer. Unsigned. Microsoft WebView2 Evergreen Runtime must already be installed; it is not bundled. |
| Apple Silicon macOS | [App archive](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.9/chronoscope-macos-arm64.tar.xz) | Extract the complete archive and copy Chronoscope.app to Applications. Ad hoc signed, not notarized. Fresh quarantined-download acceptance remains unverified. |

Keep the accompanying third-party notices and source-access instructions. The release includes exact application and locked dependency sources, license notices, `SHA256SUMS.txt`, `RELEASE-MANIFEST.json` and per-platform native validation receipts. All published assets were independently downloaded without GitHub credentials and checked against their SHA-256 hashes. Older releases and tags are preserved.

Both exact packages passed native hosted checks of the extracted desktop CLI/agent/MCP, GUI launch and an attached engine query. Mac checks also verify the strict bundle seal, App Intents metadata and weak-linked frameworks. These are narrow automated checks, not manual installation, physical GPU/smart-card, normal quarantined-download or production acceptance. Local Mac flight canvas captures were unavailable while its screen was locked; actual saved scenes and moving-window playback passed headless Chrome checks. Back up projects before preview testing.

No Linux or Intel Mac binary is included. Broad Mac distribution still needs Developer ID signing/notarization and fresh-download acceptance. The Apple model diagnostic requires macOS 26+; Apple Intelligence is not an SI Chat provider.

See the [release checklist](RELEASE-CHECKLIST.md), [distribution obligations](DISTRIBUTION.md) and [local security checks](SECURITY-CHECKS.md).

## Build from source

Desktop: **Rust 1.96+**, **Node 22+**, and [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). CLI-only core declares Rust **1.96+** and needs neither Node nor a window system. Locked dependencies can impose newer compiler requirements; the local verification compiler is recorded separately, not a minimum-version test.

- macOS: full Xcode26.6 / macOS SDK26.5 for the tester build configuration (native compilation remains the gate); see [Mac handoff](MAC_HANDOFF.md).
- Windows: MSVC C++ build tools/Windows SDK and WebView2, as described by Tauri.
- Linux: WebKitGTK 4.1/GTK3 development prerequisites and platform linker tools; consult Tauri and the manual workflow package list. Do not install packages merely to run the CLI.

Use [README commands](../README.md). For distributable builds use `python3 scripts/build_portable.py build --locked --release -p chronoscope --bin chronoscope` or `python3 scripts/build_portable.py -- npm run bundle` to remap repository/Cargo/home compiler paths. Existing effective environment flags are preserved and remaps appended. `RUSTFLAGS` follows Cargo’s whitespace splitting: quotes are literal and backslashes (including Windows paths) are not shell-unescaped. If an individual argument contains spaces, use `CARGO_ENCODED_RUSTFLAGS` with a literal unit separator (U+001F) between arguments; it takes precedence over `RUSTFLAGS`. For example in Python: `env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(["-C", r"link-arg=C:\SDK Folder\foo.lib"])`. If using target-specific Cargo configuration, pass its effective rustflags via `CARGO_ENCODED_RUSTFLAGS` (or `RUSTFLAGS`) first: Cargo environment flags override configured flags. The wrapper does not edit configuration and refuses implicit configured flags rather than dropping them. Verify final binary strings and notices; Rust remapping alone does not cover Swift/linker/generated resources or old published binaries.

## Appearance and existing installations

The running Mac Dock and Windows window icons follow the selected appearance; Finder/Explorer/pinned shortcuts can retain the packaged pearl icon. Linux uses the pearl fallback.

Default settings and automatic document copies migrate once from former Chronoscope Cesium folders. Close the earlier app first; see [profile migration](MAC_HANDOFF.md#settings-and-automatic-document-copies). Explicit `--data-dir` profiles are not migrated. Regenerate external client setup from Preferences → MCP setup at the final installed location.
