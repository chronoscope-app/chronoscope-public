# Streets default map validation · 2026-10-17

Chronoscope 0.15.1 replaces the built-in seven-provider catalog with one preselected **Streets** map: OpenFreeMap Positron. Custom WMTS servers, independent layers, authentication and cache settings remain under Advanced map settings. Existing custom settings and older shared projects retain their presentation.

The screenshots below are actual application captures using the Rust HTTP bridge and production frontend, with real OpenFreeMap streets beneath the built-in **192-event synthetic San Francisco movement study**. The map is real; the Event positions are demonstrations, not measured movements. Provider attribution remains visible.

- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)

## Verification

- All 246 Rust unit/integration tests passed across 38 test targets, run sequentially within the cloud disk limit.
- Strict Clippy, Rust formatting, generated-contract checks, TypeScript checking and production Vite build passed.
- Nine real-source browser checks passed: default selection, tile alignment, settings, renderer teardown/recreation, space-time, globe, fresh-renderer disk-cache reuse offline, custom WMTS editor and strict desktop CSP without uncaught errors. See [live report](live-report.json).
- The same nine checks also passed with an offline local vector fixture; [offline report](offline-report.json). The fixture is not used in these screenshots.
- All 13 real mouse/keyboard navigation checks passed across globe, space-time, 2D and calendar, including selection, wheel modifiers, bounded zoom and the shared CLI/MCP view adapter; [navigation report](navigation-report.json).
- Existing terrain/geoid resource mathematics checks passed. This run does not claim a new Streets-over-DTED visual test.

Public requests used two network workers and 200 ms pacing during testing, with a persistent private cache. Production retains normal loading without that test pacing. Source metadata, fonts and vector tiles reuse the Rust cache rather than a proxy service.

Environment: Linux Chromium with SwiftShader software rendering, real Rust engine, and the desktop Content Security Policy injected into the browser harness. These checks do not establish native macOS/Windows compatibility or physical GPU throughput. No GitHub runners were used, and no new macOS installer was built here.

Reproduce the offline integration checks with `npm --prefix frontend run test:basemap` after building the CLI and frontend. Set `CHRONOSCOPE_BASEMAP_LIVE=1` only for an intentional live-provider run. Run `npm --prefix frontend run test:navigation` with `CHRONOSCOPE_CLI` pointing at the built CLI to check real mouse/keyboard navigation independently.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
