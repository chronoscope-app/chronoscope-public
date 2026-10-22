# Globe time elevation and compact legend

Globe now offers an off-by-default Time elevation toggle. UTC time becomes display elevation along the WGS84 surface normal above local terrain. The Globe slider is independent of Space-time: its default maximum is 12% of study extent, capped at 50 km. A logarithmic 0.05–20× multiplier changes this live; the UI shows the resulting maximum offset in metres/kilometres. A local study therefore starts with a smaller offset than an Atlantic-scale study. Source coordinates, timestamps, WKT Z values and physical terrain heights are unchanged.

Tracks and WKT use their event times; enabled vertical trails connect events to the ground. Heat, bloom, density rasters, terrain and WMTS imagery stay on the surface. Automatic/count clusters retain UTC slabs, and existing marker/cell/geometry budgets remain in force. Time elevation disables ground-footprint culling for events that may be visible above the horizon. Fit includes the elevated volume. Workspace and named-view state, CLI/MCP schemas and generated frontend contracts include `globe_time` and `globe_time_scale`; older files default to surface events and scale 1.

The legend starts at 210 pixels, has a bounded narrow resize range and wraps long names without horizontal overflow. Navigation controls wrap within smaller viewports.

Validation passed locally:

- Production TypeScript/Vite build, native Linux Tauri build and generated contract check.
- 16 Rust tests across `cesium_scene`, `display_lod` and `views_layers`, including old defaults, invalid scale rejection, saved/reopened scenes, named views, unchanged source events, temporal clusters and ground-only effects.
- Chromium/SwiftShader integration with real Rust bridge: native marker coordinates agree with independent WGS84 ECEF calculations within 10 micrometres. Toggle, live independent slider, API scale changes on an active view, saved states, flat-view behavior, narrow-window controls, long-label wrapping and light/dark themes passed.
- Real bundled NOAA hurricane data: 1,604 events from 2021 onward, with 38 rendered tracks, use the 50 km default; all projected events remain in frame. Dark/light captures are included. These are attributed source tracks, not synthetic motion.
- Actual Tauri WebKitGTK under Xvfb/llvmpipe: attached stdio MCP enables the option; native button handlers toggle and synchronize it; native slider changes save their scale; MCP changes an already active scale; live MCP captures the rendered native canvas. The native fixture is a small synthetic local track and demonstrates a smaller study-relative default.
- No public WMTS requests: browser traffic was blocked and counted (zero); native WMTS transport was offline and map sources disabled. The globe uses bundled NASA Blue Marble.

These tests use Linux software rendering. They do not claim physical GPU, Mac or Windows verification. See the JSON reports, Rust log and PNG captures alongside this file. Repeat the browser integration with `npm --prefix frontend run test:globe-time` after building the CLI/frontend.
