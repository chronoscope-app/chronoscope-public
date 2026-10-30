CHRONOSCOPE TRANSITION LAB - LOCAL WINDOWS LONG SESSIONS

Source: 53815c11315e46c53cdb3027f1411245dd2942bb
Binary SHA256: 759d8955d0161923cfa0f4054c9ac5e96c243ed379a2917db7ad436b2a18245f
Based on latest verified Next main 389ffcd plus the completed local Interaction Lab branch. Nothing pushed to Next/Public.

Native full optimized Windows app; private profile per dataset, autosave enabled; governor enabled; 1 Hz process CPU/private resident RAM and attributed GPU allocation/3D counters. 20-second active phases with repeated pause/play, real-pointer rail scrub, selection, style, supported/unsupported renderer and view transitions. Initial warmup is recorded separately. Frame intervals from postRender (not monitor presentation). Idle gaps between phases excluded. No explicit garbage collection. Retain every phase and raw OS sample.

Dataset | measured active minutes | total session minutes | sampled renders | unready active-renderer frames | median prepared/full FPS | p99 range ms | gaps >50ms (all phases, including intentional standard rendering)
100k-map | 10.00 | 11.94 | 37406 | 0 | 60.02 | 19.9-25.2 | 65
  Preparation/warm-up accepted durations ms: 274.7, 232.8, 212.8, 339.4, 307.9, 213.4, 213.6, 215.1, 246.4, 280.5, 216.9, 358.2, 436.6, 448.7, 224.4, 495.7, 508.3, 494.3, 177.8, 372.0, 435.1, 447.4, 536.8, 248.0, 448.1, 164.9, 513.0
  Repeated stopped-navigation private RAM MiB: 489.7, 578.0, 723.5
flights-altitude | 5.00 | 5.92 | 18533 | 0 | 59.77 | 33.9-40.4 | 26
  Preparation/warm-up accepted durations ms: 145.9, 225.4, 221.3, 61.4, 262.4, 131.1, 215.0
  Repeated stopped-navigation private RAM MiB: 725.4, 697.4
satellites-altitude | 5.00 | 6.23 | 18377 | 0 | 60.04 | 19.9-23.5 | 27
  Preparation/warm-up accepted durations ms: 2015.5, 2231.1, 2026.3, 464.1, 1883.0, 2553.5, 2409.9
  Repeated stopped-navigation private RAM MiB: 724.4, 856.2
terrain-gps | 5.00 | 6.83 | 21820 | 0 | 60.06 | 18.3-22.8 | 34
  Preparation/warm-up accepted durations ms: 525.2, 224.0, 284.2, 243.5, 521.0, 193.6, 248.7, 230.5, 141.2
  Repeated stopped-navigation private RAM MiB: 618.0, 727.9
weighted-heatmap | 5.00 | 6.56 | 20138 | 0 | 59.99 | 25.6-35.4 | 15
  Preparation/warm-up accepted durations ms: 198.2, 137.9, 164.1, 167.3, 121.1, 170.3, 165.5, 154.8, 141.8, 123.4, 139.6, 145.5, 141.2, 137.9, 62.1, 161.2, 152.3, 68.7
  Repeated stopped-navigation private RAM MiB: 890.7, 910.4

Measured remaining limits: the dense satellite cluster-to-track transition had a 1,436 ms frame gap; terrain-backed Time-view navigation measured 50.6 FPS while tiles loaded (maximum gap 254 ms). Repeated 100k stopped-navigation phases used 490, 578 and 724 MiB private resident RAM. Steady prepared FPS does not establish that every transition is stutter-free or that RAM is leak-free.

VERIFIED TERRAIN-ON PLAYBACK COMPARISON (same final binary/settings; standard then prepared; 5s warm + 20s measured each):
Standard: FPS 60.05, CPU 9.77%, private RAM 591.1 MiB, GPU 3D 22.32%, GPU allocated 233.9 MiB; terrainActive=True
Prepared: FPS 60.05, CPU 5.01%, private RAM 540.8 MiB, GPU 3D 19.93%, GPU allocated 232.2 MiB; terrainActive=True

Correction: the earlier VFX 2 terrain-labeled performance row used GPS with terrain inactive. These verified terrain-on trials replace that terrain interpretation; historic numeric observations remain valid only as flat-GPS measurements.

Build provenance: 100k-map, flights-altitude, satellites-altitude retain their measured source 9f7154736eb3ab1071b6655fdf1a6e5d3fc5b43d / binary 5677af8775be5848e9fb382650366158a7925fac842eea4a8f7db9e57e1e5518. The final terrain-only recovery change does not execute in those terrain-disabled measured phases. Terrain and heatmap use final source 53815c11315e46c53cdb3027f1411245dd2942bb / binary 759d8955d0161923cfa0f4054c9ac5e96c243ed379a2917db7ad436b2a18245f. Per-phase hashes are in phases.csv; all focused source checks use the final revision.

Actual pixel evidence: 160 native framebuffer samples across 20 renderer swaps, zero samples with missing event pixels. Separate browser test covers delayed canonical preparation, cancellation cleanup, Time-frame cancellation and renderer disposal.
Every stopped point-rendering phase checks unique source IDs against the engine; a representative subset is allowed only when the renderer explicitly reports LOD. A reopened heat-only source legitimately has no point markers; its complete engine event count and exact weighted cells are checked instead. Weighted heatmap stopped phases also compare all bins and values with engine display_data. Each dataset switches to an earthquake study and back.

Tradeoffs and limits:
Prepared graphics hold the old valid scene until replacement buffers have completed Cesium updates; cancelled obsolete work is removed. Curved-track construction yields between chunks and caches each entity color/record position. Time axis changes are published only with the replacement; stopping Time playback still restores its ordinary exact-window frame.
Initial data decoding, geometry combination and GPU upload can still take time; these changes do not promise zero latency or zero stutter. Preparation durations are recorded separately. Full frame timing arrays and source IDs are retained in raw report.json.
Long-frame counts include intentional standard rendering and governor transitions; inspect phases.csv to distinguish those from steady prepared rendering. The tests cover tens of minutes on one Windows machine, not multi-hour sessions, every GPU or every interaction.
GPU counters report Windows-attributed allocation, not unique physical VRAM residency. Native postRender cadence is not physical display presentation latency. Background apps and OS scheduling can affect results.
The existing 100k-event/2048-entity prepared limits, styling differences, unsupported-mode fallbacks and normal governor remain. Time manual rail scrubbing remains on its canonical renderer.

Raw native records: C:\Users\admin\Documents\ChatGPT\Win Chronoscope\chronoscope-transitions-local\.qa\transitions\native-soak\report.json
