# Local full Chronoscope VFX experiment

This branch is an experimental full Windows Chronoscope application based on Next main `1c05df9`. It is not the old synthetic renderer playground. Keep it local until the user explicitly approves integration into Next; do not promote it to Public.

Use normal Open/import, filters, Tables, selection, save/export, and Play. The separate native product is **Chronoscope VFX Experimental**, with a separate application identifier and data profile. The **Smooth playback** checkbox compares the new playback path with the standard renderer.

The GPU path prepares the complete non-time-filtered point pool once, advances the visual clock each frame, and publishes ordinary engine filter/table snapshots at up to 4 Hz. Pause commits the final exact window. Picking resolves actual event IDs; selecting, changing non-time filters, or changing an incompatible scene returns to the canonical renderer. Time mode keeps a stable full-study time axis during accelerated playback, restoring the exact-window frame on pause.

Acceleration currently supports regional instantaneous located point datasets up to 100,000 events and 2,048 entities in Time, Map and Globe. Terrain, altitude, measurement/summary styles, durations, rich geometry, global/dateline datasets, and existing selections use standard playback. All these features remain available in the app. GPU tracks are thin straight segments and do not yet reproduce canonical departure afterimages or every polyline detail.

The full-app hardware comparison and nine workflow checks passed; see `browser-report.json`. Native build provenance, package checks, and the native WebView2 report are retained beside the delivered local executable and in `.qa/full-app-2026-10-30`.
