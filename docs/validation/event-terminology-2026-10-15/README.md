# Events terminology — 15 October 2026

Timestamped records are now called **Events** throughout the current desktop UI, offline help, Rust/TypeScript implementation, CLI/MCP descriptions, errors, tooltips, sample labels and active documentation. Entities still group events for the same subject; an event can have a point, geometry or no known location. Track and coordinate behavior are unchanged.

## Compatibility

- Existing `.chronoscope` workspace formats, data and saved context remain readable. Imported source column names, labels and attributes are preserved, including text containing the former term.
- Private working databases use `events.sqlite`. Recovery continues to accept older `observations.sqlite` databases with the same directory and lease validation.
- Legacy input headers `observationDate` and `observationTime` still auto-detect. Separate dates/clocks with seconds/fractions still floor to minute precision.
- Display bins expose `event_bounds`; deserialization also accepts `observation_bounds`, preserving identical coordinates. Capabilities exposes `max_events`. Clients that hard-code the former output keys must update; see [agent migration details](../../CLI-MCP.md#event-terminology). Command names remain unchanged.
- Historical benchmark evidence, validation screenshots and archived video source/captures retain their original wording. Current documentation identifies them as historical.

## Current UI

[Current screenshot gallery](../../screenshots/current/README.md)

This actual browser render shows 40 synthetic Atlanta events in three entities over one previously cached USGS topographic tile. The single cached 256-pixel tile is shown at a larger display size; this capture checks terminology and desktop interaction, not terrain or image-resolution quality. No DTED is loaded. Public imagery is attribution-preserved. This pass makes zero public WMTS requests. Rendering uses Linux Chromium WebGL2/SwiftShader, without a physical GPU.

The [UI report](ui-report.json) verifies event search/counts, the Events table, selected-event inspector and existing map-provider/attribution workflows. [Current screenshot gallery](../../screenshots/current/README.md) also uses the new terminology.

## Local verification

**24 consolidated local checks passed**: 21 in the [core/browser report](local-report.json), plus three in the [native report](native-report.json). The Rust suite passed **201 tests**, including three new compatibility tests. The frontend production build, generated contracts, Clippy and all 12 offline browser suites pass. [Validation logs](logs/) retain the detailed output.

The focused [compatibility tests](logs/terminology-tests.log) cover unchanged source labels/attributes and minute parsing through save/reopen, canonical/legacy display-bin decoding with identical coordinates, and real pre-rename recovery databases with notes and saved groups.

The [native report](native-report.json) records successful Linux Tauri Clippy/build and bundled CLI/MCP startup/discovery/query smoke tests. Consolidated validation results are recorded alongside this report. No GitHub runners are used. Native macOS/Windows execution and physical-GPU performance are not verified on this Linux host.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
