# Display feedback and renderer recovery — 2026-10-17

Verified locally on macOS with native WebKit and hardware Chromium. No hosted workflows were dispatched.

- Reproduced the former attribute-count failure through Cesium's actual longitude splitter using fading line geometry spanning −106° to +12°, and −179° to +179°. Position-only unlit geometry now passes; fade alpha still updates a uniform rather than all stem vertices.
- Targeted Rust display/layer tests and UTC-axis/line-geometry checks passed. Heat and bloom retain located and time-only event data in every map view. Existing saved line strengths remain unchanged; new defaults use 25%.
- Ten hardware browser groups passed on the real Atlantic hurricane sample (3,568 events): reversed elevation, cross-hemisphere fading, independent event visibility, distinct heat and bloom images before pointer release, all three map views, automatic render-error recovery, and explicit refresh after recovery.
- Actual WebGL context loss/restoration passed with local terrain and raster fixtures.
- Built and ad hoc signed the native app, opened all hurricanes over Streets with heat/bloom enabled and track/trail strengths at 25%. Native refresh retained the map. Moving-window playback rendered up to 417 fading vertical stems in the sampled frames with zero rendering errors. Restored the full time range and left the app open.

The original native runtime diagnostics reported `All attribute lists must have the same number of attributes.` macOS denied access to its system log store; no administrator access was requested. The error was independently reproduced and fixed in the geometry pipeline.

Compass designs are proposals only; the current compass remains until a design is selected. Windows and Linux runtime verification was not performed.
