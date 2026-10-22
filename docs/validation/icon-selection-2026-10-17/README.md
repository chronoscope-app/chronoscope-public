# Icon appearance and additive entity selection

The amber crosshair now has pearl and slate backgrounds. The packaged icon is pearl. The running macOS Dock icon follows the native system appearance event, including the initial appearance at startup; internal web UI theme changes do not override it. Finder and the closed-app Dock icon remain pearl. A small main-thread AppKit adapter owns the only production FFI call; the desktop executable retains `forbid(unsafe_code)`.

Windows uses the same PNG variants for its running window icons on native app-theme changes. NSIS remains `currentUser`, and the executable explicitly requests `asInvoker`, with `uiAccess=false`. Common Controls v6 remains in the manifest. No machine-wide registry writes, services or elevation were introduced. Pinned shortcuts and Explorer retain the packaged pearl icon. Linux uses the pearl fallback.

Entity selection uses plus/minus circles. Selecting an entity adds all of its events; clicking again removes its events while retaining other entities. This also clears partial and filtered-out selections. Pending click intent is serialized with table selection, and keyboard focus survives refresh. Workspace expansion uses outward/inward diagonal arrows, including when restoring a saved scene. Space activates focused buttons instead of starting playback.

## Local verification

- Native macOS example: real Tao appearance notifications produced **Light → Dark → Light**. Only the test process's appearance changed; no system appearance preference was written. Captured AppKit Dock images matched each variant after system color conversion: mean channel errors 2.60 and 4.75/255, versus over 156/255 for the opposite variant. Invalid image data and worker-thread access were rejected.
- Eight real Rust-bridge browser groups passed: additive/deselect behavior, rapid clicks, partial/hidden selections, keyboard focus, workspace expansion and scene restoration, linked shading, light/dark contrast, and clearing selection.
- Rust formatting and desktop/adapter Clippy checks passed with warnings denied.
- Windows icon code and per-user/asInvoker packaging were inspected locally. **No Windows runtime or installer execution was available on this Mac.**

Reproduce the native check on macOS after the frontend and Rust prerequisites are installed:

```sh
node scripts/generate_icons.mjs
npm --prefix frontend run build
mkdir -p .qa/icons
cargo run --locked --release -p chronoscope-desktop --example icon_appearance_qa -- .qa/icons/icon-native-appearance.json
node scripts/check_icons.mjs .qa/icons
cargo fmt --all --check
cargo clippy --locked -p chronoscope-desktop -p chronoscope-dock-icon --all-targets -- -D warnings
```

`check_icons.mjs` uses the existing frontend `pngjs` development dependency and macOS `sips` for AppKit's extended-range TIFF captures. Generated captures remain in `.qa`; source icons and the summarized [report](report.json) are checked in. The native example shares the production icon handler and exercises the native appearance event path without exposing testing commands in the shipped app. All verification was local; no GitHub workflow was dispatched.
