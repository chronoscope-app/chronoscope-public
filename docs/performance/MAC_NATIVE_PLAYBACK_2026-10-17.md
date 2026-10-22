# Native playback: 100k events and bloom

Native macOS playback improved from run medians of **22–27 FPS to about 55–56 FPS**, keeping the same rendering settings. The final rebuilt app measured **55.7 FPS**. This is closer to the 60 FPS target; it is not a claim of uninterrupted 60 FPS. The final median p95 frame interval was 43 ms, so periodic update spikes remain.

Baseline commit: `94cea68470433fc0d804164460ebaaea0490840c`. All builds, profiling and verification ran locally. No GitHub Actions or hosted runners were used. Raw observations and validation summaries are in [the accompanying JSON](mac-native-playback-20261017.json).

## Workload and measurements

The workload is the same real SQLite-backed synthetic dataset from the 100k benchmark: 100 entities × 1,000 UTC-timestamped events. The application retains 100,000 source records and uses the full 100,000-marker budget. Its normal Play behavior moves a 25% time window; approximately **25,100 events are visible and drawn during these playback samples**. This does not claim simultaneous playback of 100,000 visible markers. Separate full-range native tests draw all 100,000 markers.

Measurements used the native Tauri WKWebView on Apple M5/macOS 27.0.1, not Chrome's frame counter. Canvas size remained 1,062 × 737 CSS pixels, resolution scale 1.5, framebuffer 1,593 × 1,105. Antialiasing, point sizes, opacity, tracks, vertical trails and the 200 ms smoothstep fade remained enabled. Bloom retained its 512 × 512 raster, radius 0.1, strength 1.3 and threshold 0.1. Both builds used the same bundled Blue Marble floor, with public imagery and terrain disabled for the paired performance comparison. Automatic document saving was disabled during paired measurements and restored after testing.

Each run used three native diagnostic observations eight seconds apart after an eight-second warmup, covering nearly a complete 25-second playback loop. The diagnostic reports a rolling 120-render-frame window. No GPU tests or compilation ran concurrently with FPS measurements. The baseline was restored and retested between candidate runs; the final candidate was rebuilt and retested afterward. Profiles were collected separately from the FPS observations.

| Native run | Median FPS | Median observed p95 frame interval | Median observed p95 CPU render submission | Median MCP query |
|---|---:|---:|---:|---:|
| Baseline A | 22.3 | 101 ms | 13 ms | 0.68 ms |
| Baseline repeat | 27.1 | 77 ms | 12 ms | 0.66 ms |
| Candidate A | 55.3 | 45 ms | 11 ms | 0.76 ms |
| Final rebuilt candidate | 55.7 | 43 ms | 11 ms | 0.58 ms |

Individual baseline readings ranged from 16.4 to 34.2 FPS, versus 53.7 to 56.6 for the candidates. These are local observations, not independent statistical trials or a cross-platform performance guarantee. CPU submission timings exclude asynchronous GPU work and presentation waits.

## Why this helps

The native profiles showed WebKit waiting on GPU presentation and Metal spending much of its sampled graphics work servicing `bufferSubData`. Cesium's small-change path sends individual uploads when fewer than 10% of a point collection's members change. During playback, a small fraction of a large collection fades in every frame. WebKit/ANGLE Metal can repeatedly copy/fence the buffer for those small uploads.

Arriving points and inferred triangles now use separate native collections. All members of each small arriving batch fade together, allowing Cesium's ordinary bulk-upload path to handle them. Steady points retain their own collection. No Cesium internals or vendor source are patched. Every record keeps its original ID, position, shape, color, outline and fade. Diagnostics count both steady and arriving glyphs. Pausing consolidates opaque glyphs into canonical packet order, including coincident-record depth ties in map/globe views.

The WebGL context also uses a non-preserved drawing buffer. Capture waits for resources, requests a final render, and copies the canvas in the same JavaScript task before presentation can clear it. Thus continuous rendering does not retain the previous drawing buffer just for screenshots. Direct framebuffer QA readbacks use the same render-then-copy lifetime rule.

The controlled fade regression measured **1,023 → 44 actual GL buffer uploads over 12 frames** (95.7% fewer). Its fixture contains 10,000 glyphs, with 100 arrivals including inferred triangles. It verifies every glyph ID, total point/triangle count, exact selection, half-fade alpha and consolidation on pause. The new test fails against the baseline's sparse-upload behavior.

In separate OS profiles, native WebKit presentation stacks fell from 2,843/4,661 sampled main-thread stacks to 227/2,626. The GPU graphics-queue `bufferSubData` path fell from 1,275/2,172 sampled stacks to 1/2,776. These stack fractions include waiting time; they are not CPU utilization or precise GPU timings. The two optimizations were measured together rather than independently attributing their contributions.

## Quality and functional verification

- The controlled half-faded framebuffer was pixel-identical between baseline and candidate. The settled fixture differed at 64 pixels by at most one color level.
- Matched native full-range captures with all 100,000 markers were pixel-identical. After a globe → map → space-time round trip, 235 edge pixels differed, with the camera basis differing by approximately 2e-16; the record counts and display settings remained unchanged. These additional round-trip results are retained in the JSON rather than described as universally bit-identical captures.
- All 32 browser/Cesium integration checks passed directly on macOS, using the platform-appropriate table selection modifier, including the new GPU-upload, point/triangle fade and selection regression. Actual context loss/recovery, the heat/bloom framebuffer suite and the 100k scale suite also passed. Those browser suites are functional checks, not substitutes for native FPS measurements.
- Native globe, map and space-time each drew all 100,000 full-range markers, retained base imagery and reported zero rendering errors. Bloom on/off changed 29,807 native pixels. Selecting the latest three queried records during active playback produced exactly those three selected records and three native selection markers, while 800 glyphs were in the arriving batch in the observed frame.
- Direct attached CLI snapshot returned 100,000 records. CLI PNG capture produced a nonblank 1,593 × 1,134 image, including its attribution footer. The tuned app remains open with the full dataset, bloom enabled and normal automatic saving restored.

## Existing terrain precision failure

The deeper terrain accuracy suite still fails its requirement for level ≥12 and source agreement within 3 m in Globe. Both the baseline and candidate loaded level 8 and produced **exactly the same nine height errors**, ranging from about 7.25 to 84.16 m. Painted-pixel counts also matched. Terrain implementation and test accuracy thresholds were not changed. This existing terrain LOD/precision issue remains unresolved and is separate from the playback optimization.
