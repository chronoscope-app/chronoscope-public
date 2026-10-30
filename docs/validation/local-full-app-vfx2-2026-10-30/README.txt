CORRECTION (2026-10-30): The historical terrain-labeled performance row used the animal GPS study with terrain rendering INACTIVE (terrainActive=false in its raw diagnostics). Treat that row as flat-GPS performance, not terrain-draped performance. The other dataset measurements are unchanged. Verified terrain-on replacement trials are recorded in the Transition Lab long-session report.

Chronoscope VFX Experimental 2 - local Windows comparison

Full native app; source 179b3e8672ffdca4eff47cb813c64775922b3152
Binary SHA-256: 76510fc816d9374e409640f51d30368a243ab1a2ba0f551cfa33cd47835c79ba

Each renderer uses a fresh app process/profile. Same dataset, styles, 20% moving time window and normal quality governor.
8 seconds loaded idle, 8 seconds playback warm-up, 20 seconds measured playback, then 10 seconds scripted pan/zoom/tilt while playing.
CPU = share of all logical processors. RAM = summed private resident memory of app + WebView2.
GPU = Windows-attributed busiest 3D engine and dedicated allocations. Render FPS is not physical presentation latency.
One short trial per renderer/dataset on this PC; tracks/fading remain experimental. See report.json for details.
Track-path measurements were repeated after batching. Unchanged heatmap/control and standard baselines retain the preceding build measurements; per-case build hashes are recorded.

Philippines flights with altitude - Standard
  FPS 47.5; frame p95 62.3 ms; >50 ms gaps 141
  CPU 11.53%; private RAM 677 MiB; GPU 3D 20.6%; GPU allocations 236 MiB
  Pan/zoom/tilt while playing: 48.8 FPS, CPU 11.99%
  Play command including preparation: 47 ms

Philippines flights with altitude - VFX 2
  FPS 60.0; frame p95 29.4 ms; >50 ms gaps 0
  CPU 5.61%; private RAM 559 MiB; GPU 3D 22.5%; GPU allocations 242 MiB
  Pan/zoom/tilt while playing: 59.3 FPS, CPU 7.22%
  Play command including preparation: 343 ms

Starlink global altitude tracks - Standard
  FPS 48.4; frame p95 24.5 ms; >50 ms gaps 40
  CPU 11.98%; private RAM 670 MiB; GPU 3D 21.8%; GPU allocations 247 MiB
  Pan/zoom/tilt while playing: 40.2 FPS, CPU 12.13%
  Play command including preparation: 31 ms

Starlink global altitude tracks - VFX 2
  FPS 60.1; frame p95 18.2 ms; >50 ms gaps 0
  CPU 7.34%; private RAM 656 MiB; GPU 3D 23.3%; GPU allocations 339 MiB
  Pan/zoom/tilt while playing: 58.8 FPS, CPU 8.17%
  Play command including preparation: 1563 ms

Animal GPS over Balanced terrain - Standard
  FPS 60.1; frame p95 22.2 ms; >50 ms gaps 0
  CPU 10.39%; private RAM 482 MiB; GPU 3D 20.3%; GPU allocations 235 MiB
  Pan/zoom/tilt while playing: 60.1 FPS, CPU 11.61%
  Play command including preparation: 31 ms

Animal GPS over Balanced terrain - VFX 2
  FPS 60.0; frame p95 18.0 ms; >50 ms gaps 0
  CPU 5.00%; private RAM 403 MiB; GPU 3D 18.4%; GPU allocations 234 MiB
  Pan/zoom/tilt while playing: 60.1 FPS, CPU 6.10%
  Play command including preparation: 78 ms

FIRMS weighted heatmap - Standard
  FPS 59.9; frame p95 19.0 ms; >50 ms gaps 2
  CPU 11.51%; private RAM 551 MiB; GPU 3D 22.0%; GPU allocations 295 MiB
  Pan/zoom/tilt while playing: 59.0 FPS, CPU 12.82%
  Play command including preparation: 31 ms

FIRMS weighted heatmap - VFX 2
  FPS 59.8; frame p95 18.1 ms; >50 ms gaps 0
  CPU 9.00%; private RAM 528 MiB; GPU 3D 22.9%; GPU allocations 292 MiB
  Pan/zoom/tilt while playing: 59.1 FPS, CPU 10.82%
  Play command including preparation: 31 ms

100k synthetic track control - Standard
  FPS 25.1; frame p95 210.8 ms; >50 ms gaps 38
  CPU 11.19%; private RAM 691 MiB; GPU 3D 13.1%; GPU allocations 227 MiB
  Pan/zoom/tilt while playing: 19.3 FPS, CPU 11.86%
  Play command including preparation: 47 ms

100k synthetic track control - VFX 2
  FPS 60.0; frame p95 18.0 ms; >50 ms gaps 0
  CPU 8.39%; private RAM 605 MiB; GPU 3D 22.3%; GPU allocations 259 MiB
  Pan/zoom/tilt while playing: 57.4 FPS, CPU 8.59%
  Play command including preparation: 1719 ms

