# Track styling without geometry rebuilds

Track opacity now updates existing materials. Ordinary warmed hide/show changes
reuse polyline positions, materials and draw order. Density/heat/bloom no longer
restart because a track-only option changed.

## Correctness and memory policy

The cache holds at most the current geometry generation, using the existing
100,000 source-point cap and globe interpolation limit. Hidden streams have
empty draw-order placeholders until first enabled; their positions are built
lazily. Camera, viewport, selection anchors, data, time-height, terrain and gap
changes still invalidate geometry through the established generation/camera
keys. Hidden stale/empty collections are destroyed and recreated at their
original scene index, releasing Cesium vertex arrays that `removeAll()` alone
can retain. Context recovery resets scene-owned cache references.

The draw order remains tracks then ground tracks per entity run, including
first enabling a previously hidden stream. Diagnostics distinguish visible
polylines from allocated polylines/vertices.

Globe command bounds/depth sorting and interpolation budgets depend on which
streams have positions. The pixel comparison caught brightness changes in
roughly 900–1,500 pixels when hiding a populated globe stream, even for short
arcs. Switching individual globe layers therefore rebuilds geometry to preserve
appearance and curve detail. Nonzero opacity changes and hiding/restoring the
same warmed set remain cached. This intentional fallback means the speedup is
not uniform for every globe toggle.

## User-noticeable drawback checks

`track-style-qa.mjs` uses production Cesium through the real local Rust bridge.
It exercises 10,000 and 100,000 observations, then verifies:

- 100 actual hide/show cycles with WebGL renders in both states: stable object
  identity, tracked GPU buffer allocation and post-GC JavaScript heap.
- Camera movement while hidden and a changed time window while hidden: restored
  visible geometry must exactly match a forced fresh rebuild.
- Selection anchors, time height, terrain and temporal gaps: cached geometry
  must match a fresh rebuild. Replaced source objects must be collectible.
- Long globe arcs: hiding a stream preserves fresh-build geometry and stays
  within the 400,000-vertex retained-cache bound.
- Fixed images in time/map/globe at eight opacity/visibility states, including
  off, restore and cold activation of either stream. Before/after image comparison checks missing, lingering,
  reordered or wrongly colored tracks.
- The actual Views-panel range input with bloom enabled: each drag preview
  applies, its value label agrees, and track-only edits preserve the bloom
  atlas without restarting its worker. This interaction starts on a fresh page.

Measurements use local Chrome/SwiftShader, a 1400 × 900 viewport and device scale
1. The isolated buffer/pixel fixture disables globe imagery to avoid background
resource traffic. The real control check uses the application's ordinary scene
with bloom enabled. No physical-GPU FPS, native WebKit or whole-app VRAM claim
is made. Heap snapshots and WebGL buffer accounting do not cover all browser,
texture, driver or operating-system memory.

The performance interval contains 12 synchronous style updates followed by one
actual render, repeated three times per size. CPU time measures those style
calls; buffer bytes account for `bufferData` and `bufferSubData` allocations or
uploads, not bus traffic. End-to-end slider preview samples include two animation
frames and are reported separately with their actual rendered event count.

Baseline source: `6cf4ac1`; both frontends use the same local dependencies and
Rust bridge. Baseline/candidate output and a portable summary document the
retained-memory tradeoff rather than treating the speed improvement as free.

```sh
CHRONOSCOPE_CHROMIUM=/path/to/chrome python3 scripts/guarded_run.py -- \
  python3 scripts/validate_local.py \
  --suite track-style --suite renderer-reuse --suite cluster-identity \
  --suite cesium-context --suite cesium-effects-pixels \
  --rust-test display_lod --rust-test map_presets --browser-jobs 1
```

All verification is local; hosted workflows remain manual-only.

## Results

Median of three samples, 12 updates per sample. Milliseconds measure CPU-side
elapsed styling work, not full application latency.

| Events | Opacity / ms, before → after | Reduction | Warm hide/show / ms, before → after | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 10,000 | 507.1 → 1.2 | 99.76% | 228.0 → 1.1 | 99.52% |
| 100,000 | 5105.1 → 1.0 | 99.98% | 2311.0 → 1.3 | 99.94% |

At 100,000 events, the median geometry-buffer allocation/upload count per
interval fell from 40.8 MiB to zero. Material uniforms, visibility textures and
drawing still require GPU work; zero buffer bytes does not mean zero GPU traffic.

All 24 controlled track images match the previous renderer exactly, including
first activation of either hidden stream. The globe-only brightness regression
found during development was removed by the individual-layer fallback.

The retained-cache cost is 20.4 MiB of additional tracked buffer allocation when
one of the two warmed layers is hidden in this 100k fixture. Total tracked
buffers stayed at 59.9 MiB across 100 rendered hide/show cycles, with no additional
buffer objects. Post-GC JS heap changed by 0.56 MiB. Hidden invalidation released
track buffers, leaving 19.1 MiB for the fixture's other buffer resources, and
replaced source objects were collectible. These observations are bounded-cycle
evidence, not a whole-app or indefinite leak guarantee.

The actual slider applied all previews and preserved bloom. Effect-worker
restarts fell from 2 to 0 in that interaction. Its small 192-event, three-preview
frame-timing sample is too limited to establish a consistent end-to-end speedup;
raw preview times are preserved in the summary.

Final local verification passed: production build, generated contracts, Rust
formatting/Clippy, 10 relevant Rust tests, 29 frontend test files, and six browser
suites across the comprehensive and final focused runs. The final globe,
clustering, track-memory and user-control checks passed on the fixed source.

See the [portable measurement summary](track-style-reuse-20261028.json) for raw
medians, memory accounting, control samples, source hashes and image results.
