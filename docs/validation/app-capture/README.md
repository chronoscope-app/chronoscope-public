# Whole-app MCP and CLI screenshots

Based on `aaebee6ff38db7fcd95153f335924eb472bd8dc9`. See [capture usage and boundaries](../../CLI-MCP.md#whole-app-screenshots).

`view_capture` defaults to native app content (`target:app`, `window:main`). It captures visible panels, tables, charts, timeline, docked SI and HTML dialogs with their actual composited map/canvas pixels. Explicit `target:map` retains the attributed canvas export. An open detached chat can be captured with `window:si-chat`. No operating-system screen capture or arbitrary external window identifier is accepted.

## Verification

- **60 Rust tests passed:** 45 library tests, nine Cesium/agent integration tests and six SI chat tests. The added tests cover default/explicit capture scopes, MCP image content without duplicated base64, invalid targets/windows, headless/native errors, unlocked workspace reads during capture, proportional image resizing and retained image corners. SI map presentations explicitly request map-only content.
- **Six real Linux native checks passed** using Tauri/WebKitGTK, Xvfb and software rendering. Attached stdio MCP returned a **1600 × 973** full-app PNG with bundled Atlantic hurricane Events, a rendered ECharts bar chart, source attribute table, sidebars and timeline. The explicit map image was **652 × 514**. Native MCP also captured the Help dialog and an **860 × 873** detached SI chat. CLI atomic PNG saving with spaces and overwrite protection passed; a closed chat returned UNAVAILABLE. The report and screenshots are included here.
- Linux native compile check and executable build passed. The complete snapshot adapter passed a Windows GNU-target `cargo check`; this is compilation evidence, not a native Windows run.
- The macOS WKWebView/NSImage/NSData code passed an isolated Apple-target API type check with a compile-only Tauri pointer boundary. This caught and corrected an NSData API mismatch. The full cross-target Tauri check was blocked by the absence of an Apple-capable Objective-C compiler on this Linux host. **Native Mac compilation, execution, WebGL capture and Retina behavior remain for local verification.** No native Windows execution or physical GPU performance claim is made.
- Production TypeScript/Vite builds, generated contracts, Rust/frontend formatting and diff whitespace checks passed. No GitHub runners or billed SI services were used. Tests configured maps offline and used bundled imagery/data; public WMTS was not exercised.

Native screenshot timeouts, source pixel counts, decoded memory, output dimensions and encoded image size are bounded. Captures report their requested target/window from the engine's own pending ticket. App snapshots do not wait for map readiness or silently substitute a map image; the current loading/error UI is itself capturable.

## Reproduce

```sh
cargo build --locked -p chronoscope-desktop
cargo test --locked -p chronoscope --lib --test cesium_agents --test si_chat
npm --prefix frontend run build
node scripts/generate_contracts.mjs --check
cargo fmt --all --check
python3 scripts/test_app_capture.py --binary target/debug/chronoscope-desktop --output /tmp/chronoscope-capture-qa
```

The native script requires Linux WebKitGTK, Xvfb, xdotool and Pillow. It isolates its XDG profile, enables only local agent access and disables external maps. Relocated SDK/helper paths can be supplied through the normal launch environment; `--xvfb`, `--xdotool` and `--cwd` accept local runtime paths. Optional `CHRONOSCOPE_QA_HELP_X/Y`, `CHRONOSCOPE_QA_CHAT_X/Y` and `CHRONOSCOPE_QA_POPOUT_X/Y` drive the corresponding visible native buttons; the screenshots themselves always come through attached MCP. The recorded run used Help (1064,50), SI (1025,50) and Pop out (1520,456) in a 1600 × 1000 X11 window with a 27-pixel native titlebar.

[Current screenshot gallery](../../screenshots/current/README.md)

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
