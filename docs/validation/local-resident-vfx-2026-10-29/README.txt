LOCAL EXPERIMENT - not promoted to Next or Public

Prepared GPU playback, phase 1: regional Globe points and tracks. A fixed 100k-observation pool and 99,900 segments are uploaded once into two draw primitives (9,593,600 prepared CPU-array bytes, not a measured VRAM allocation). Each animation frame updates two time-window uniforms. Pixel readback confirms the empty/full windows produce different images.

Same local Windows hardware Chrome / ANGLE NVIDIA Quadro RTX 3000 Direct3D11 renderer; 1440x960 framebuffer, scale 1. Three alternating 15-second paired trials, 20% moving time window. Conventional path installs changing 20k packets at a maximum of 10 Hz; resident path clips that moving window in shaders. No renderer errors or focus loss in any retained trial.

The control has production playback marker reuse enabled; both variants hold the governor at full quality. Earlier cold-rebuild smoke measurements are excluded.

conventional_packets: median rendered FPS 10.41; median frame p95 131.1 ms, p99 142.4 ms; worst frame 172.5 ms; total >50 ms gaps 374.
resident_gpu: median rendered FPS 60.07; median frame p95 17.3 ms, p99 17.9 ms; worst frame 30.5 ms; total >50 ms gaps 0.

One-time preparation took roughly 0.3 seconds, followed by shader/upload warm-up outside measured playback.

This is evidence for the rendering architecture, not full-app or visual parity. Conventional tracks are wider polylines; the prototype uses one-pixel straight GL_LINES, soft point discs, shader-clipped temporal edges and a fixed resident sample. It does not implement picking, selection highlighting, inferred glyphs, durations, terrain/geodesic/date-line correctness, departure history, bloom or exact engine-filter synchronization. It supports regional Globe only. CPU preparation is synchronous once; background worker preparation, future-chunk prefetch and full Space-Time/Map support remain follow-up work. No import/query work is included, and render-loop cadence is not physical presentation or GPU execution timing.

Recommendation: retain this prototype locally. The next engineering step is persistent production-grade track buffers with temporal fades and selection/picking, then integration with exact filters on pause and a bounded read-only prefetch path. Repeat native WebView2 tests and visual parity checks before any merge decision.
