# Next 0.16.0: altitude, reset and Mac validation

Validated application source: `f80c3b598d3a54df862fcdabceb3f703316c4b8d`, following altitude implementation `8f9a80e`. The native title and bundle versions both read **0.16.0**. Rust Tauri core is exactly **2.12.5**, tauri-build 2.7.4; the corresponding published JavaScript API/CLI packages are 2.12.4.

The vertical menu uses one segmented control with a sliding selection between Time Height and Altitude. Its elevation slider stays visible and grayed out/disabled in Altitude; selecting Time Height re-enables it with its retained value. A zero Time Height gives ground placement. Both mouse clicks and arrow-key selection were checked. Native accessibility inspection confirmed the two radio options, a disabled slider at 50 in Altitude, and the same enabled slider at 50 in Time Height.

Both [browser](browser-report.json) and [native WKWebView](native-report.json) loaded **88,018 points from 100 distinct flights** and **2,456 points from five distinct JAXA sounding-rocket launches**. Native rendering used Apple GPU / WebGL 2.0 with a 1857 × 1338 framebuffer at resolution scale 1.5. Both datasets retained their height mode and rendered matching stem counts without renderer errors. The app remains open on the rocket example.

The browser suite independently checks WGS84 ECEF coordinates, zero altitude, EGM96 correction against a published PROJ control, missing/unknown-height omission, actual importer field detection and unit/reference controls, save/reopen, and the height selector/slider behavior. Reset follows Preferences, opens a warning, focuses Cancel, cancels on Enter/Escape, and preserves data/camera after explicit confirmation. Native keyboard/visual checks also confirmed Cancel focus, Enter cancellation and an explicit successful graphics reset preserving all 2,456 rocket points.

[Verification summary and binary hash](verification.json): **157 Rust checks**, **146 frontend tests**, **20 validation-runner tests** and **5 version-metadata tests** passed. One existing full bundled-demo matrix remains opt-in/ignored; targeted altitude/real-demo/preview tests ran. Existing Time Height, display recovery and importer GUI suites passed. Marker/trail/stem reuse checks passed at 10k and 100k points. This is correctness/resource-reuse validation, not evidence of an FPS improvement. [Earlier matched native performance measurements and limits](../../performance/MAC_TRAIL_STEM_PROFILING_2026-10-28.md) still apply.

All builds and checks ran locally on an Apple M5 Mac with macOS 27.0.1. GitHub workflows remain manual-only; no hosted workflow was started and no public promotion occurred. Windows/Linux native behavior was not validated in this run. These local results do not create a public download release.

## Reproduction

Build CLI/contracts and frontend, then run the browser checks:

```sh
cargo build --locked -p chronoscope --bin chronoscope
node scripts/generate_contracts.mjs
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run test:altitude
```

Run the native app in a disposable profile, then use the reusable native check. `native_altitude_qa.py` copies the two portable sample files into that profile's private exchange directory; it does not expand MCP file access or touch the normal user profile.

```sh
CHRONOSCOPE_DATA_DIR="$PWD/.qa/altitude-native-profile" bash script/build_and_run.sh --verify
python3 scripts/guarded_run.py -- python3 scripts/native_altitude_qa.py \
  --data-dir .qa/altitude-native-profile --output .qa/altitude-native-results
```

If using this Mac's local toolchain configuration, source `.local-build/env.sh` or set `CHRONOSCOPE_BUILD_ENV` before building. Browser/runtime paths and raw logs live under `.qa/`; the JSON reports here are portable evidence. [Dataset sources, licenses, transformations and height caveats](../../ALTITUDE-DEMOS.md) include source/output checksums and the deterministic generator. Flight heights are processed barometric values and rocket heights lack a stated datum, so both examples are explicitly approximate reported heights. Format-7 altitude workspaces require an altitude-capable reader.
