# Installation and platform status

Current release: **[0.16.4 experimental desktop preview](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.4)**, published 2026-10-29. Windows uses application source `b5146aa48db73b60bc9ef7353758cd90782d70f3`; macOS uses `498b888a93bc95d5491dec1915a4c624354cd1c3`. Application code, assets and dependency locks are byte-identical; the later commit repairs Mac validation cleanup. Both packages were built and checked on manually dispatched GitHub-hosted runners. Older previews remain separate historical builds.

Release candidate source is **0.16.9**, including continuous playback fade, clearer light-mode markers, idle CPU improvements, automatic resource budgets and a seven-day, six-airport flight demo. The owner authorized promotion and hosted Windows/macOS release builds; the downloads below remain 0.16.4 until the exact replacement packages pass validation and are published. See the [changelog](../CHANGELOG.md), [resource-budget validation](performance/AUTOMATIC_RESOURCE_BUDGETS_2026-10-29.md), and [flight-demo validation](validation/flight-week-mac-2026-10-29/README.md).

## Preview downloads

| Platform | Download | Installation and trust status |
| --- | --- | --- |
| Windows x64 | [ZIP with current-user installer](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.4/chronoscope-windows-x86_64.zip) | Extract the complete ZIP and run its installer. Unsigned. Microsoft Edge WebView2 Evergreen Runtime must already be installed; it is not bundled. |
| Apple Silicon macOS | [App archive](https://github.com/chronoscope-app/chronoscope-public/releases/download/v0.16.4/chronoscope-macos-arm64.tar.xz) | Extract the complete archive and copy Chronoscope.app to Applications. Ad hoc signed, not notarized. Fresh quarantined-download acceptance on a user's Mac remains unverified. |

Keep the accompanying third-party notices and source-access instructions. The release includes exact application and locked dependency sources, license notices, `SHA256SUMS.txt`, `RELEASE-MANIFEST.json` and per-platform native validation receipts.

## Verification and limitations

Native runners checked the exact downloaded packages: hashes, architecture, physical notices, actual packaged desktop CLI/agent/MCP smoke tests, GUI launch and an attached engine query. Mac checks also verified the strict bundle seal, App Intents metadata and weak-linked frameworks. These are narrow automated checks, not real-device, GPU, manual installer, smart-card or production acceptance. Back up projects before preview testing.

Windows remains unsigned. Broad Mac distribution still needs Developer ID signing/notarization and fresh-download acceptance. The Apple model readiness diagnostic requires macOS 26+; Apple Intelligence is not an SI Chat provider. No Linux or Intel Mac binary is included in this release; source builds do not establish native acceptance on those platforms.

See the [release checklist](RELEASE-CHECKLIST.md), [distribution obligations](DISTRIBUTION.md), [changelog](../CHANGELOG.md) and [local security checks](SECURITY-CHECKS.md).

## Build from source

Desktop: **Rust 1.96+**, **Node 22+**, and [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). CLI-only core declares Rust **1.96+** and needs neither Node nor a window system. Locked dependencies can impose newer compiler requirements; the local verification compiler is recorded separately, not a minimum-version test.

- macOS: full Xcode26.6 / macOS SDK26.5 for the tester build configuration (native compilation remains the gate); see [Mac handoff](MAC_HANDOFF.md).
- Windows: MSVC C++ build tools/Windows SDK and WebView2, as described by Tauri.
- Linux: WebKitGTK 4.1/GTK3 development prerequisites and platform linker tools; consult Tauri and the manual workflow package list. Do not install packages merely to run the CLI.

Use [README commands](../README.md). For distributable builds use `python3 scripts/build_portable.py build --locked --release -p chronoscope --bin chronoscope` or `python3 scripts/build_portable.py -- npm run bundle` to remap repository/Cargo/home compiler paths. Existing effective environment flags are preserved and remaps appended. `RUSTFLAGS` follows Cargo’s whitespace splitting: quotes are literal and backslashes (including Windows paths) are not shell-unescaped. If an individual argument contains spaces, use `CARGO_ENCODED_RUSTFLAGS` with a literal unit separator (U+001F) between arguments; it takes precedence over `RUSTFLAGS`. For example in Python: `env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(["-C", r"link-arg=C:\SDK Folder\foo.lib"])`. If using target-specific Cargo configuration, pass its effective rustflags via `CARGO_ENCODED_RUSTFLAGS` (or `RUSTFLAGS`) first: Cargo environment flags override configured flags. The wrapper does not edit configuration and refuses implicit configured flags rather than dropping them. Verify final binary strings and notices; Rust remapping alone does not cover Swift/linker/generated resources or old published binaries.

## Appearance and existing installations

The running Mac Dock and Windows window icons follow the selected appearance; Finder/Explorer/pinned shortcuts can retain the packaged pearl icon. Linux uses the pearl fallback.

Default settings and automatic document copies migrate once from former Chronoscope Cesium folders. Close the earlier app first; see [profile migration](MAC_HANDOFF.md#settings-and-automatic-document-copies). Explicit `--data-dir` profiles are not migrated. Regenerate external client setup from Preferences → MCP setup at the final installed location.
