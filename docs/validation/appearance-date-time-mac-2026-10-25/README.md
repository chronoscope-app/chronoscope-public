# Playback, appearance and date/time display — Mac validation

Implemented and validated locally against Next main at `bcdad25`. No hosted workflow or public promotion was used. The app was rebuilt and launched with a disposable native profile; Cargo and browser suites ran one at a time.

- Playback has a 208 CSS-pixel popup and an accessible pill-style Fade switch. Exact range controls retain their separate width.
- New profiles default to System appearance. Explicit saved Light/Dark choices survive migration. System appearance follows live OS changes; manual changes override it.
- Display-only Preferences updates no longer cancel map work, resample terrain, reinstall raster imagery or restore the camera. Map/terrain preference changes still refresh their resources.
- Preferences → General offers the system locale, ISO dates, month/day/year and day/month/year with two/four-digit years, dotted dates, and month-name dates. Clocks support system locale and 12/24-hour formats with optional seconds.
- Formatted UTC readouts cover the time rail, timeline, Space-time axis, event tables/tooltips, chart labels/data and pattern evidence. Exact input fields, stored epochs, imports, exports and calculation scopes remain canonical and retain fractional seconds. Subsecond axes retain distinguishing precision even with a minute-only clock preference.
- The on-map terrain banner is removed; terrain information remains available in Layers and Terrain settings.

## Local verification

- Standard runner, formatting, core/native lint, builds and generated contracts pass.
- Ten focused Rust tests cover basemap/map-stack behavior, display defaults, legacy preferences, date/time validation and persistence, and unchanged Event timestamps.
- All 66 frontend unit tests pass, including date presets, clocks, UTC/year boundaries and negative/fractional epochs.
- Six browser suites pass: navigation/preferences, playback speed, time rail, sidebar time, subsecond behavior and charts in UTC/New York/Tokyo. The navigation/preferences suite additionally verifies live System appearance, explicit overrides, unchanged camera/viewer/provider, zero raster/terrain calls, date/time Save/Cancel behavior and compact switch styling. It waits for initial fonts/camera settling before taking the comparison baseline.
- Six native MCP checks pass. Desktop Light/Dark/System and date/time updates retain the exact camera and terrain provider and produce no new terrain-mesh requests.
- Native Map, Globe and Space-time recordings contain 1,029 decoded frames, with no flash candidates or Cesium render errors. Deliberately inserted dark/light frames are detected by negative controls. These are bounded wildlife navigation sequences, not a guarantee for every dataset or interaction.
- Actual macOS UI was inspected with a fresh System profile. [Preferences](preferences-system.jpg) and [playback popup](playback-compact.jpg) are native screenshots. Structured results are in [report.json](report.json).

The app is left open on this Mac. Raw logs, screenshots and MP4 recordings are retained locally under `.qa/appearance-date-time/`.
