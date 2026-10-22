# Branding and source-credit validation

The interface and installed app are named Chronoscope Prototype. The Cesium/ion default logo is disabled through the public CreditDisplay API because no ion imagery, terrain or services are used. Provider credits are preserved, including any provider-required on-screen credits. The expandable credit list uses a compact, keyboard-accessible ⓘ control.

Local checks:

- TypeScript and production frontend build passed.
- Chromium/SwiftShader UI suite passed with no page or caught UI errors. It verifies the unbranded interface, packaged licenses, NASA credit access with Enter/Escape, source-credit handling for a synthetic local raster, both themes, existing map-menu behavior and attribution in exported screenshots.
- Both Rust prototype-isolation tests passed, including live-engine attachment to separate profiles.
- No public WMTS tiles were fetched during these checks. The displayed flat-color raster is a synthetic attribution fixture, not real-world imagery.

Upstream licensing and notices are bundled at `cesium/LICENSE.md` and `third-party/` in the frontend assets. Existing data-profile paths, bundle identifier and MCP registration remain stable. Native packaging and OS window chrome require verification after rebuilding on the target platform.
