# Workspace controls — 15 October 2026

Entity/category lists now sort by name or quantity in either direction, collapse independently, and show ten items until **Show all** is selected. Attribute tables scroll continuously, keep a bounded 100-row DOM window, and follow observation search and active filters by default. Exact selection and keyboard navigation span the full result set. Source-column windows remain available for wide tables.

Display sliders preview while dragging and coalesce backend commits. Point size and line opacity reuse geometry; bloom parameters use shader uniforms. Instance bounds are refreshed when glyph size changes. Save waits for pending display commits, and completing a slider cannot replace another inspector tab.

Mouse-wheel zoom targets the cursor. A 76-pixel N/S/E/W rose replaces the larger navigation panel. Four 14-pixel spheres at the side-face centres rotate/tilt space-time, with keyboard arrow support. The Display Legend overlay and scene instruction banner are removed; the separate entity legend remains available.

Mode changes explicitly reload imagery with generation guards. This release also incorporates Mac Codex commit `575dda2` (historical identifier; earlier Git history is not included), which draws the translucent data floor before viewport imagery. Both fixes address the black/covered imagery observed after returning from Globe.

## Verification

The [consolidated results](validation.json) retain the original run and targeted reruns. Rust formatting, strict core linting, **196 Rust tests**, CLI build, contracts, frontend production build, three unit suites, eleven browser suites, and native Linux lint/build/CLI smoke checks pass. Additional software WebGPU rendering and real-data exercises are archived alongside them. No GitHub runners were used.

- [24,000-row workspace regression](workspace-controls.json): exact Jose search (27 records), sorting/counts/top-ten lists, collapse, continuous scrolling, bounded DOM rows, cross-window Shift selection, Home/End, live slider preview during an intentionally blocked backend commit, save ordering, inspector-tab preservation, four rotation handles, cursor anchoring and seven imagery mode transitions.
- [Navigation regression](navigation.json): 108 independent WGS84 ENU heading/tilt cases, centre retention, camera persistence, live display controls, bloom/map isolation in both themes, time axes and playback transitions.
- [WMTS return regression, WebGL](globe-transition-webgl.json) and [software WebGPU](globe-transition-webgpu.json): seven view changes and eight data-floor pixel checks across both themes, space-time/2D and bloom on/off. Synthetic local tiles make missing or obscured imagery measurable without public traffic.
- [Display WebGPU](display-webgpu.json): actual software WebGPU exercises clusters, heat, bloom, terrain and globe. [Public-data exercise](public-ui-report.json): real NOAA Excel, USGS earthquakes, GBIF observations, hurricane tracks and 95,718 VIIRS detections; actual DTED2 terrain and previously cached EOX/NASA imagery. Zero new public WMTS requests.
- [Native Linux results](native-report.json): strict desktop lint, embedded-asset build and attached CLI/MCP smoke checks.

The first full run found three test-harness assumptions needing updates: removed compass zoom-button selectors; a rose drag starting on the relocated N button plus scientific-notation rotation parsing; and an absolute callback-count assertion unsuitable for variable software-renderer frame rates. The playback test now compares focus updates against actual animation callbacks. The new Mac test additionally required this VM's Vulkan/SwiftShader launch flags for its WebGPU swapchain; the final run asserts the actual WebGPU backend. Initial failed attempts remain in the evidence and are not treated as passing runs.

Software rendering validates behavior, not physical GPU frame rates. This session did not execute the new native UI on macOS or Windows. Mac Codex's commit records its own native macOS validation. Extremely large virtual scroll ranges are compressed to stay within browser height limits; only 24,000-row table navigation was exercised here. Earlier million-row backend findings remain in the separate comprehensive report.

## Screenshots

Real GBIF observations above DTED2 with cached Sentinel WMTS imagery; the four small spheres, compact rose and top-ten entities are visible:

[Current screenshot gallery](../../screenshots/current/README.md)

Real NOAA Excel observations and stationary analysis with a continuously scrolling attribute table:

[Current screenshot gallery](../../screenshots/current/README.md)

Real VIIRS detections in light mode:

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
