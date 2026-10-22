# Installation and platform status

Current source: **0.15.2 (unreleased)**. **No binaries have been published in this clean repository yet; build from source.** This is a standalone source snapshot, not a fork or a copy of earlier history, tags or release attachments. Older preview executables are not included and are not cleared by current-source tests or security fixes.

## Platform limitations

- macOS: broad distribution still needs Developer ID signing/notarization and native fresh-download acceptance. Earlier ad hoc development launches do not establish those gates. Optional Apple Intelligence requires macOS 26+ and a ready on-device model.
- Windows: native installer, GUI/WebView2 and hardware/card acceptance remain separate release gates; Wine console/engine tests do not prove them. A future portable distribution must retain its DLLs and notices and document the required WebView2 Runtime.
- Linux: source builds and historical local evidence do not establish supported-distro binary acceptance.
- Intel macOS: a source/CI target is not a native-tested download.

No cross-platform native acceptance, signed-binary availability or complete binary-license/source-access clearance is claimed. See the [release checklist](RELEASE-CHECKLIST.md), [distribution obligations](DISTRIBUTION.md), [changelog](../CHANGELOG.md) and [local security checks](SECURITY-CHECKS.md).

## Build from source

Desktop: **Rust 1.90+**, **Node 22+**, and [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). CLI-only core declares Rust **1.89+** and needs neither Node nor a window system. Locked dependencies can impose newer compiler requirements; the local verification compiler is recorded separately, not a minimum-version test.

- macOS: full Xcode26.6 / macOS SDK26.5 for the tester build configuration (native compilation remains the gate); see [Mac handoff](MAC_HANDOFF.md).
- Windows: MSVC C++ build tools/Windows SDK and WebView2, as described by Tauri.
- Linux: WebKitGTK 4.1/GTK3 development prerequisites and platform linker tools; consult Tauri and the manual workflow package list. Do not install packages merely to run the CLI.

Use [README commands](../README.md). For distributable builds use `python3 scripts/build_portable.py build --locked --release -p chronoscope --bin chronoscope` or `python3 scripts/build_portable.py -- npm run bundle` to remap repository/Cargo/home compiler paths. Existing effective environment flags are preserved and remaps appended. `RUSTFLAGS` follows Cargo’s whitespace splitting: quotes are literal and backslashes (including Windows paths) are not shell-unescaped. If an individual argument contains spaces, use `CARGO_ENCODED_RUSTFLAGS` with a literal unit separator (U+001F) between arguments; it takes precedence over `RUSTFLAGS`. For example in Python: `env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(["-C", r"link-arg=C:\SDK Folder\foo.lib"])`. If using target-specific Cargo configuration, pass its effective rustflags via `CARGO_ENCODED_RUSTFLAGS` (or `RUSTFLAGS`) first: Cargo environment flags override configured flags. The wrapper does not edit configuration and refuses implicit configured flags rather than dropping them. Verify final binary strings and notices; Rust remapping alone does not cover Swift/linker/generated resources or old published binaries.

## Appearance and existing installations

The running Mac Dock and Windows window icons follow the selected appearance; Finder/Explorer/pinned shortcuts can retain the packaged pearl icon. Linux uses the pearl fallback.

Default settings and automatic document copies migrate once from former Chronoscope Cesium folders. Close the earlier app first; see [profile migration](MAC_HANDOFF.md#settings-and-automatic-document-copies). Explicit `--data-dir` profiles are not migrated. Regenerate external client setup from Preferences → MCP setup at the final installed location.
