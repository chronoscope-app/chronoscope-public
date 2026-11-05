# Installation and preview status

Current source is **0.16.16**, with Charts re-enabled, editable chart axes, compact pane navigation, notification dismissal and persistent background visibility controls. The local Mac build is updated to 0.16.16 for testing. Published downloadable packages remain at the platform versions listed below; source promotion does not replace those downloads.

The current Windows x64 download is the [0.16.15 experimental preview](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.15), built and checked on GitHub-hosted Windows runners from frozen Public `1895b72a1e3a2b71bdf2b62b5f49551dc0e126f9`. It adds quiet toolbar clocks, denser Time rail labels and clearer trajectory demo defaults, plus complete Windows installer/web file inventories and matching installer sources. [Release acceptance scope](validation/release-0.16.15-publication/README.md).

Apple Silicon macOS and Linux x64 remain on the [0.16.14 experimental preview](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.14), built on the native development computers. Mac source is `a8f432eb2da8d4a78ac58b33ef39ee99bacba092`; Linux source is `920877a514450848b8cee71d9c87804e9fbff110`. [Their source mapping](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/SOURCE-PARITY.json). No Mac or Linux runners or packages were created for 0.16.15. Those older packages keep Charts and Patterns disabled; current 0.16.16 source re-enables Charts. See the [changelog](../CHANGELOG.md).

## Preview downloads

| Platform | Download | Installation and trust status |
| --- | --- | --- |
| Windows x64 | [ZIP with current-user installer](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.15/chronoscope-windows-x86_64.zip) | Extract the complete ZIP and run its installer. Unsigned. Microsoft WebView2 Evergreen Runtime must already be installed; it is not bundled. |
| Apple Silicon macOS | [App archive](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/chronoscope-macos-arm64.tar.xz) | Extract the complete archive and copy Chronoscope.app to Applications. Ad hoc signed, not notarized. Fresh quarantined-download acceptance remains unverified. |
| Linux x64 | [ZIP with AppImage](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/chronoscope-linux-x86_64.zip) | Extract the complete ZIP, permit the AppImage to execute, and run it. Tested on Ubuntu 26.04.1 with glibc 2.43; older distributions remain unverified. Retain the native-source and replacement companions. |

Keep the accompanying notices and source-access instructions. Windows 0.16.15 includes matching application, locked registry and exact NSIS/LZMA, plugin and installer-template source archives. Every physical installer/wrapper file and embedded web file, including graphics, fonts, metadata and terrain, is accounted for. Mac/Linux source companions remain with 0.16.14. All published assets passed complete anonymous download/hash checks; historical releases and tags remain unchanged.

The exact 0.16.15 Windows package passed an independent hosted download/extraction, native CLI and GUI-engine/attached-MCP check. This does not establish visual interaction, manual installer acceptance, or physical GPU/smart-card compatibility. [Windows evidence and limits](validation/release-0.16.15-publication/README.md). The earlier Mac/Linux packages retain their [0.16.14 local acceptance scope](validation/release-0.16.14-publication/README.md), including offline views, queries and save/reopen. Back up projects before preview testing.

Linux's GnuTLS dependency has two upstream-disputed certificate-validation reports with deferred Ubuntu fixes. The actual online update check passed; no malicious-server acceptance in Chronoscope was demonstrated. Read the [release security disclosure](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.14) and native security receipt before relying on this experimental package. The earlier 0.16.14 Windows diagnostic strings retain a disclosed generic public dependency-cache path. For 0.16.15, bounded source/native-string/hosted-web scans and file inventories found no user-specific credentials; the payload review records Cesium’s original evaluation default token.

No Intel Mac binary is included. Broad Mac distribution still needs Developer ID signing/notarization and fresh-download acceptance. The Apple model diagnostic requires macOS 26+; Apple Intelligence is not an SI Chat provider.

See the [release checklist](RELEASE-CHECKLIST.md), [distribution obligations](DISTRIBUTION.md), [local build procedure](LOCAL-RELEASES.md) and [local security checks](SECURITY-CHECKS.md).

## Build from source

Desktop: **Rust 1.96+**, **Node 22+**, and [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). CLI-only core declares Rust **1.96+** and needs neither Node nor a window system. Locked dependencies can impose newer compiler requirements; the local verification compiler is recorded separately, not a minimum-version test.

- macOS: Xcode 27.2 / macOS SDK 27.2 for the recorded local preview build (native compilation remains the gate); see [Mac handoff](MAC_HANDOFF.md).
- Windows: MSVC C++ build tools/Windows SDK and WebView2, as described by Tauri.
- Linux: WebKitGTK 4.1/GTK3 development prerequisites and platform linker tools; consult Tauri and the manual workflow package list. Do not install packages merely to run the CLI.

Use [README commands](../README.md). For distributable builds use `python3 scripts/build_portable.py build --locked --release -p chronoscope --bin chronoscope` or `python3 scripts/build_portable.py -- npm run bundle` to remap repository/Cargo/home compiler paths. Existing effective environment flags are preserved and remaps appended. `RUSTFLAGS` follows Cargo’s whitespace splitting: quotes are literal and backslashes (including Windows paths) are not shell-unescaped. If an individual argument contains spaces, use `CARGO_ENCODED_RUSTFLAGS` with a literal unit separator (U+001F) between arguments; it takes precedence over `RUSTFLAGS`. For example in Python: `env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(["-C", r"link-arg=C:\SDK Folder\foo.lib"])`. If using target-specific Cargo configuration, pass its effective rustflags via `CARGO_ENCODED_RUSTFLAGS` (or `RUSTFLAGS`) first: Cargo environment flags override configured flags. The wrapper does not edit configuration and refuses implicit configured flags rather than dropping them. Verify final binary strings and notices; Rust remapping alone does not cover Swift/linker/generated resources or old published binaries.

## Appearance and existing installations

The running Mac Dock and Windows window icons follow the selected appearance; Finder/Explorer/pinned shortcuts can retain the packaged pearl icon. Linux uses the pearl fallback.

Default settings and automatic document copies migrate once from former Chronoscope Cesium folders. Close the earlier app first; see [profile migration](MAC_HANDOFF.md#settings-and-automatic-document-copies). Explicit `--data-dir` profiles are not migrated. Regenerate external client setup from Preferences → MCP setup at the final installed location.
