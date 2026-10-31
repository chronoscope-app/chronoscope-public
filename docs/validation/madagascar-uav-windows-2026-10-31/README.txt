SYNTHETIC MADAGASCAR UAV WEEK — WINDOWS VALIDATION

Source: 6785c2c77d91bab76c45949551c848ef6413a07d, Next 0.16.10.

Replaces the short KABR telemetry demo and its bundled previews/provenance with a clearly labelled synthetic week: 12 aircraft, four generic types, 84 complete flights on 1–7 March 2026 UTC, and 17,243 observations. Every aircraft flies every day. Routes cover 44–556 km, durations are 35.5–265.5 minutes, and 36 flights land on Nosy Be, Sainte-Marie or Mayotte. Each new day starts at the previous landing. The generator is offline and deterministic in this environment; repeat generation produced the same workspace SHA-256.

The default Map shows Day 1 with type colors and no height legend. Saved views cover the full week, each day, Globe heights and a focused complete quadcopter flight. Overnight gaps break tracks. Heights and nominal performance are illustrative synthetic values, not observed activity, surveyed elevation or terrain clearance. Origin is explicit in the catalog, workspace, attributes, documentation and exported attribution.

Passed: optimized CLI build, generated contract consistency, eight Rust tests (one existing full matrix ignored), production frontend, all 175 frontend unit tests, the focused browser suite, actual renderer previews, selected-notice checks in Node and Python, optimized Windows desktop build and attached native verification. The release Rust test binaries for madagascar_uav_demo, space_demos and real_demos were executed directly after Cargo built them. The broader Cargo compilation was stopped while compiling additional controls; altitude_controls was not run. Its changed demo-id metadata is covered by the new dataset tests, browser gallery and native catalog checks. No failing test was bypassed.

See report.json for the exact local command results, source hashes, native captures and scope. Native checks cover the new catalog, Day 1, full-week Time, regional Globe, focused flight, Day 7 and day playback with all records retained.

Initial native attempts exposed a cold readiness timeout and a test assumption about the engine filter during prepared playback. The loaded scene was inspected before retrying; playback was verified against its live resident window and then the committed engine filter after pause. Final native checks passed. Original attempts remain in the ignored evidence directory.

This updates Next and the local Windows application. Public, release/download assets, tags and manual-only workflows are unchanged. Screenshots and raw logs remain ignored local evidence under .qa/madagascar.
