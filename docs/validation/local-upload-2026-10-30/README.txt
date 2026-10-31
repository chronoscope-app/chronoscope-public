INCREMENTAL GEOMETRY/GPU UPLOAD WINDOWS VALIDATION

Measured in the full optimized Windows Upload Lab app, then owner-authorized for Next main on 2026-10-30. Next restores the normal Chronoscope product name, application identifier and existing-profile migration. The source changes are not promoted to Public. The original Windows test binary remains an isolated local app. Previously completed Interaction Lab/Transition Lab changes were separately promoted to Next 4834867 / Public 6bcd11d. macOS performance is not established by these Windows results; use an optimized native Mac build for the next test.

Changes: split actual GPU geometry into <=8192-vertex pages, preserve overlapping timed track endpoints, warm one page between frames while retaining the previous drawing, share materials/uniforms across pages, and retain exact record/entity IDs for picking. Yield position resolution, stable entity/time/ID sorting, seam splitting and typed-array packing to input/rendering; freeze the target Time frame while preparing. Avoid repeated per-vertex temporary arrays and cache colors/positions during preparation.

Full native optimized Windows Tauri/WebView2, disposable profiles, governor enabled. Same full source re-prepared 3 times while navigating, then 120 seconds of continuous playback and pan/zoom/tilt. A normal UI off/on transition reestablishes the application-managed renderer after the direct cancellation test. Frame and RAF gaps include synchronous constructor and initial uploads; preparation duration includes GPU readiness. 1 Hz process CPU, private RAM and Windows attributed GPU counters. No forced GC. 20% time window. No terrain in these paired upload-isolation cases.

dataset | variant | median worst rebuild frame ms | median total preparation ms | steady FPS | CPU % | private RAM MiB | app GPU 3D % | allocated GPU MiB
100k-map | baseline | 413.2 | 425.7 | 59.99 | 9.41 | 705.5 | 20.54 | 265.2
satellites-altitude | baseline | 1661.6 | 2235.9 | 60.04 | 8.25 | 845.7 | 28.7 | 335.5
100k-map | paged | 25.3 | 1012 | 59.99 | 9.4 | 834.3 | 21.38 | 267.4
satellites-altitude | paged | 48.1 | 2767.3 | 60.05 | 9.57 | 844.4 | 19.07 | 338.1

All repeated preparations accepted without missing/unready active buffers, renderer errors or early removal of the old renderer. Canceled candidates released their installed/queued primitives and retained the old drawing. Exact engine-window IDs matched before and after sustained playback. Existing interaction, framebuffer handoff, reference and terrain recovery checks passed.

Limitations:
Three preparation repetitions per variant/dataset, two consecutive one-minute active navigation/playback phases per case; eight measured steady native minutes total. This is not a multi-hour endurance test.
Frame times are native WebView2 postRender cadence, not monitor presentation latency.
Preparation timings include construction, GPU readiness and frame scheduling; smaller uploads can increase total preparation time.
Paired cases isolate 100k regional and eligible global altitude tracks without basemap/terrain. Separate reference/recovery checks cover true terrain semantics.
CPU is normalized over 16 logical processors. Windows GPU allocation is attributed allocation accounting, not unique physical VRAM residency.
CPU work uses a yielding scheduler and bounded geometry pages; individual Cesium/driver operations and garbage collection still do not have a hard maximum frame time.

Binary source: a07a19873eb6fb72ea7d669048e63906c68636a3
New binary SHA256: 6910aef92e041e4811a945ea03cc342ddace1e3e45c237d7a3a491e2ecca73c5

Raw native intervals, screenshots and OS samples remain in .qa/uploads/native. Harness scripts were executed from the parent Windows workspace and use sibling paths/portable tools.
