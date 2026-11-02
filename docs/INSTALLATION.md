# Installation and preview status

Current downloads are the [0.16.14 experimental preview](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.14) for Windows x64, Apple Silicon macOS and Linux x64, built on the three native development computers. Mac and Windows use Public `a8f432eb2da8d4a78ac58b33ef39ee99bacba092`; Linux uses `920877a514450848b8cee71d9c87804e9fbff110`, which adds only Linux launcher/preparation changes. Application code, frontend, resources and dependency locks match. [Exact source mapping](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/SOURCE-PARITY.json).

This preview adds resumable local release builds, fixes the Linux launcher's long-folder-path handling, and lets Intel UHD, HD and Iris graphics use full rendering paths when resources permit. Charts and Patterns remain disabled while in development. See the [changelog](../CHANGELOG.md) and [release acceptance scope](validation/release-0.16.14-publication/README.md).

## Preview downloads

| Platform | Download | Installation and trust status |
| --- | --- | --- |
| Windows x64 | [ZIP with current-user installer](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/chronoscope-windows-x86_64.zip) | Extract the complete ZIP and run its installer. Unsigned. Microsoft WebView2 Evergreen Runtime must already be installed; it is not bundled. |
| Apple Silicon macOS | [App archive](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/chronoscope-macos-arm64.tar.xz) | Extract the complete archive and copy Chronoscope.app to Applications. Ad hoc signed, not notarized. Fresh quarantined-download acceptance remains unverified. |
| Linux x64 | [ZIP with AppImage](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.14/chronoscope-linux-x86_64.zip) | Extract the complete ZIP, permit the AppImage to execute, and run it. Tested on Ubuntu 26.04.1 with glibc 2.43; older distributions remain unverified. Retain the native-source and replacement companions. |

Keep the accompanying notices and source-access instructions. Mac/Windows use `chronoscope-source.zip`; Linux uses `chronoscope-linux-source.zip`. The exact locked registry sources are shared unchanged. Linux additionally includes native distribution/runtime source, patches, notices and rebuild/replacement instructions. All published assets were downloaded without GitHub credentials and matched their SHA-256 hashes; historical releases and tags remain unchanged.

The actual packaged apps passed native CLI/agent/MCP, offline-view/query and save/reopen checks. Mac also passed strict signature, archive inventory and App Intents metadata checks; Linux passed long-path launching and covered-library replacement/relink tests. These are scoped local automated checks, not manual installer, normal quarantined-download, physical GPU/smart-card or broad production certification. Back up projects before preview testing.

Linux's GnuTLS dependency has two upstream-disputed certificate-validation reports with deferred Ubuntu fixes. The actual online update check passed; no malicious-server acceptance in Chronoscope was demonstrated. Read the [release security disclosure](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.14) and native security receipt before relying on this experimental package. Windows diagnostic strings retain a disclosed generic public dependency-cache path; bounded scans found no private project content or credentials.

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
