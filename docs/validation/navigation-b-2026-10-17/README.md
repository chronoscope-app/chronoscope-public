# Stacked sphere and slider navigation

Implements concept B: a plain shaded sphere centered above a single narrow rail. The sphere's hit target is 60 CSS pixels (48 in a short scene); its shaded surface is smaller. It has no continents, graticule or secondary globe renderer. A rotating north indicator and heading readout reflect the existing scene camera. The whole navigation group rests at 12% opacity, becoming fully visible on hover, keyboard focus, dragging or while its time flyout is open. Devices without hover keep it visible. Reduced-motion settings disable the fade transition. The Orbit icon is a globe with a curved rotation arrow.

The 44-pixel rail provides Orbit/Pan, Select, Fit, optional Fit terrain, vertically stacked continuous Zoom and Tilt sliders, and a vector clock/elevation icon. The flyout opens by hover, keyboard focus or click; Escape or clicking outside dismisses it. Globe uses an elevation toggle and independent logarithmic height scale. Space-time/Calendar use time height. 2D hides tilt/time and pans with the sphere. The former bottom strip, zoom buttons, top-down button and whole-globe button are removed. Existing map keyboard shortcuts remain. In very short scenes the rail's inner controls scroll, with the flyout outside that scrolling area.

Validation uses the real Rust bridge and Chromium/SwiftShader on Linux. No GitHub runners, public SI services or public map requests are used. Map screenshots reuse an existing offline street cache; the hurricane globe uses the bundled reference image. Native macOS/WebView behavior still needs a Mac check.

Commands (after building the Rust CLI and installing frontend dependencies):

```sh
npm --prefix frontend run build
CHRONOSCOPE_QA_DATA_DIR=/tmp/navigation-b npm --prefix frontend run test:navigation-sphere
CHRONOSCOPE_CLI="$PWD/target/debug/chronoscope" npm --prefix frontend run test:navigation
npm --prefix frontend run test:pan-direction
npm --prefix frontend run test:globe-time
node scripts/generate_contracts.mjs --check
cargo fmt --check
git diff --check
```

Reports cover live sphere rotation, keyboard operation, immediate stop, sliders in all four modes, unchanged Event timestamps/selection, shared camera adapter behavior, independently checked WGS84 globe elevation, popup dismissal, narrow/table-open layouts, both themes and desktop content-security policy. Navigation changes add no Rust dependencies or image downloads. The Mac transcript availability fix already on main is retained.

`navigation-report.json` records the control and layout checks, `keyboard-report.json` the broader camera and focus behavior, `globe-time-report.json` the independent elevation references, `pan-report.json` screen-direction checks, and `parity-report.json` the broader Cesium UI regressions. The latter includes wheel/slider zoom in every native scene mode, WKT, dense clusters, selection, tables, time controls and portable scene state.
