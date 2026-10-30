LOCAL CHRONOSCOPE INTERACTION LAB - WINDOWS RESULTS

Comparison: completed Next main versus local codex/resident-interactions-local.
Machine: Quadro RTX 3000, 16 logical CPUs; 16 GiB RAM.
Fresh native Tauri/WebView2 process and private profile per case; same dataset/styles/governor; 20% visible time window. 8s idle, 20s paused pan/zoom/tilt, 20s time-rail scrubbing (real pointer capture followed by RAF pointer-move events), then 15s selected playback after 5s warm-up. CPU/private RAM and Windows-attributed GPU counters sampled at 1Hz. CPU normalized over all logical processors. FPS is postRender cadence, not presentation latency. Background saving is disabled during the comparison. Basemap and terrain are off to isolate event/effect rendering; separate reference checks cover terrain and altitude correctness.

Dataset | Phase | FPS Next -> Lab | CPU % Next -> Lab | Private RAM MiB Next -> Lab | GPU 3D % Next -> Lab | GPU dedicated MiB Next -> Lab
100k-map | idle | 0.0 -> 0.0 | 0.53 -> 0.65 | 378.0 -> 733.5 | 0.0 -> 0.0 | 287.6 -> 293.2
100k-map | paused-navigation | 57.33 -> 59.98 | 7.73 -> 3.03 | 454.9 -> 490.4 | 22.87 -> 19.49 | 263.8 -> 248.1
100k-map | scrubbing | 30.12 -> 59.96 | 11.95 -> 8.0 | 643.6 -> 513.1 | 16.26 -> 19.74 | 272.0 -> 262.7
100k-map | selected-playback | 21.79 -> 60.11 | 10.8 -> 6.98 | 691.9 -> 539.5 | 16.32 -> 24.41 | 254.1 -> 261.8
global-altitude | idle | 0.0 -> 0.0 | 0.56 -> 0.6 | 758.8 -> 1145.0 | 0.0 -> 0.0 | 271.3 -> 387.4
global-altitude | paused-navigation | 58.4 -> 59.87 | 7.21 -> 4.31 | 635.8 -> 609.3 | 24.88 -> 20.45 | 230.4 -> 325.2
global-altitude | scrubbing | 30.88 -> 60.02 | 12.23 -> 6.05 | 762.2 -> 650.1 | 15.01 -> 19.64 | 239.8 -> 331.4
global-altitude | selected-playback | 25.92 -> 60.03 | 10.89 -> 7.14 | 797.2 -> 763.5 | 13.74 -> 25.49 | 221.0 -> 334.1
mixed-heatmap | idle | 0.0 -> 0.0 | 0.78 -> 0.51 | 581.3 -> 623.8 | 0.45 -> 0.0 | 340.3 -> 363.6
mixed-heatmap | paused-navigation | 59.14 -> 58.12 | 6.41 -> 7.93 | 648.8 -> 739.0 | 24.96 -> 28.55 | 331.6 -> 320.0
mixed-heatmap | scrubbing | 57.74 -> 59.97 | 16.63 -> 11.65 | 836.9 -> 836.7 | 28.35 -> 30.52 | 343.9 -> 322.2
mixed-heatmap | selected-playback | 59.55 -> 60.09 | 12.89 -> 9.24 | 838.9 -> 801.1 | 29.2 -> 33.85 | 341.0 -> 312.4
polygons | idle | 0.0 -> 0.0 | 0.37 -> 0.33 | 767.3 -> 807.6 | 0.0 -> 0.0 | 287.0 -> 297.0
polygons | polygon-selection-stress | 59.35 -> 59.98 | 8.59 -> 2.43 | 544.5 -> 398.5 | 16.3 -> 18.17 | 232.5 -> 212.5

Tradeoffs and scope:
Idle render cadence can be zero because unchanged scenes do not need redraws; it is not a performance limit.
Prepared graphics retain full eligible point/track studies and therefore use additional memory in some cases. The governor releases them under pressure.
Steady interaction figures exclude one-time preparation after opening/configuring a study. Starting a dense globe drag during that transition produced about 40 FPS and could trigger the governor; the repeated prepared globe trial reached 60 FPS. The original transition trial is retained in preparation-transition-83ed3e5.json.
Map/Globe manual scrubbing and paused navigation in all views can use prepared buffers. Time manual scrubbing retains the canonical path and vertical framing.
Polygon selection stress deliberately changes selection every animation frame directly in the renderer; it isolates geometry styling, not normal engine selection throughput.
Mixed heatmap/bloom tests retain the existing weighted engine summary and worker/atlas pipeline; there is no new GPU heatmap kernel.
The automatic governor stays enabled. Profile transitions are recorded per phase; improved work can avoid a reduction that the baseline triggers. Dense global scrub trials can still fall to the balanced profile.
Prepared limits remain 100k events / 2048 entities. Rich unsupported geometry, summary-only modes and limited selections retain standard rendering.
Existing prepared track/fade styling differences remain. Exact engine record filtering, source IDs, picking and terrain/altitude references are preserved.
Short single trials per phase and case; hardware/process scheduling can vary.
Windows GPU memory is attributed allocation accounting, not unique physical VRAM residency.
Prepared point/track styling and fading retain existing experimental differences.
Baseline viewport culling can return a subset of the exact engine window; candidate retains the complete prepared window.

Checks: 172 frontend unit tests; 21 integration/reference checks; 12 visible-pixel style handoffs; one-minute interaction soak with 0 missing-buffer frames and 0 render errors.
Raw measurements, frame intervals, screenshots and OS samples: C:\Users\admin\Documents\ChatGPT\Win Chronoscope\chronoscope-interactions-local\.qa\interactions\native-performance
Build source: 83ed3e5ea91bcd487734f28a0b30ab30c3de2323
Binary SHA256: f049839417b41d524480eff1d37e1c55ff24699cc588c0100cc7e957388e053e
This work remains local; no Next/Public push or hosted workflow was run.

Archived harness scripts in harness/ were run from the workspace root alongside
chronoscope-next and chronoscope-interactions-local. Their portable tool and
sibling fixture paths describe this Windows setup. Application code is at
83ed3e5; subsequent commits contain only verification scripts and these results.
