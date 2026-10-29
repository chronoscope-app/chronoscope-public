# Next renderer performance report

Updated 2026-10-28. Completed renderer work is on
`chronoscope-app/chronoscope-next/main` through `12d9052`. Mac native profiling
and refresh-scoped marker-position sharing for trails/stems are now recorded
below. Trail/stem topology, run/chunk reuse and shader transforms remain planned.

Use the [Mac Codex handoff](../handoffs/2026-10-28-renderer-performance-mac.md)
for checkout, local verification, native profiling and a copy-ready task brief.
Development stays in Next; public promotion requires separate user authorization.
All verification is local. Keep GitHub Actions manual-only.

## Completed work and evidence

These fixtures contain Events, not one moving entity per Event. The main 100k
synthetic fixture has 100 entities. The renderer's existing 100k point limit and
globe curve budgets remain; this work does not establish million-entity rendering.

| Change | Next commits | Measured result | Evidence |
| --- | --- | --- | --- |
| Retain marker/stem resources during selection and styling; cache track ordering within a generation | `3ddc015`, `6cf4ac1` | At 100k Events, eight selection calls: 568.7 → 0.2 ms; tracked buffer arguments 10,389,696 → 96 bytes. These tiny timings are operation-specific. | [Report](RENDERER_RESOURCE_REUSE_2026-10-28.md), [JSON](renderer-resource-reuse-20261028.json) |
| Reuse track materials/positions for opacity and safe warmed visibility changes; avoid unrelated bloom restarts | `c664af5` | At 100k Events, 12 opacity updates: 5105.1 → 1.0 ms; warmed toggles: 2311.0 → 1.3 ms. | [Report](TRACK_STYLE_REUSE_2026-10-28.md), [JSON](track-style-reuse-20261028.json) |
| Incremental moving-window markers, bounded dormant slots and adaptive small-packet fallback | `45ef153` | Paired same-build 100k tests: 26.50–28.52% less packet-installation time; 32.29–34.16% less packet-plus-render time; about 99.17% fewer live-marker recreations. | [Report](PLAYBACK_MARKER_REUSE_2026-10-28.md), [JSON](playback-marker-reuse-20261028.json) |
| Native Mac trail/stem stage profiling and reuse of current marker coordinates within a refresh | `982e38e`, `12d9052` | Matched warmed WKWebView CPU-stage observations; modest conversion savings, no overall FPS claim. Chrome's adverse 100k results retain the canonical default outside native macOS. | [Mac report](MAC_TRAIL_STEM_PROFILING_2026-10-28.md), [JSON](mac-trail-stem-20261028.json) |

The first three rows used local Chrome/SwiftShader on Linux. They
are not Mac/Metal, native WKWebView FPS, total GPU-memory or battery measurements.
The Mac follow-up separately records Chrome/Metal checks and native WKWebView
CPU stages/render intervals; it does not establish GPU or presentation gains.
Do not add percentages from different operations or present them as overall FPS.

The preferred playback comparison alternates reuse and forced rebuilding in one
warmed browser. Separate-process 10k timings varied enough to reverse the apparent
gain; both the adverse samples and paired observations remain in the report.
At 10k, paired space-time packet-plus-render time was essentially unchanged
(33.25 → 33.20 ms), despite an 11% installation-time reduction.

## What the tests established, and what remains open

- Initial resource reuse: three controlled view images matched exactly. Track
  styling: 24 controlled images matched, including cold activation and globe
  layers. Latest playback: 21 fresh controlled images and coincident pick orders
  matched, including fades, reverse scrub, reordering and pause.
- Playback's 150 rendered 2k-Event windows stayed within their slot budget,
  compacted, returned to 2k slots on pause, and released old source objects.
  Peak tracked affected buffers were 596,220 bytes; post-GC heap changed by
  246,656 bytes. These are bounded-cycle checks, not indefinite leak proof.
- The track-style cache retained an additional 20.4 MiB in its 100k warmed-layer
  fixture. The user considers that a worthwhile cost. Prioritize stable lifetime,
  release on invalidation and predictable memory over minimizing every cached byte.
- Current playback slots are bounded by visible count plus the larger of 4,096
  or 25%, with the existing 200k-slot budget ceiling. Afterimages have separate
  bounds. Pausing consolidates canonical order; empty windows clear marker slots.
- Space-time playback's six-packet buffer allocation/upload arguments increased
  by about 2.54%, while map's fell about 13.76%. Byte arguments are not bus traffic
  or total GPU work. Material/texture traffic and driver allocations are separate.
- Packets below 256 markers keep the canonical rebuild path. A small actual bloom
  playback case motivated this fallback. Software cadence still varied from 16
  to 29 presentations with unchanged adaptive code, so strict cadence assertions
  are enforced only for verified hardware runs. Software tests retain functional
  update/crossfade/pause assertions and record timing.
- Individual globe track/ground-layer switches still rebuild: retained hidden
  geometry changed command bounds/depth sorting and brightness during development.
  Keep this correctness fallback until matched pixel/native tests justify removal.
- Local builds, contracts, formatting/Clippy, 13 relevant Rust integration tests,
  29 frontend test files and six browser suites passed across focused runs. The
  detailed report distinguishes final-source checks, earlier checks and original
  software-cadence failures. [Current Mac validation](MAC_TRAIL_STEM_PROFILING_2026-10-28.md)
  now includes Chrome/Metal and native playback/capture checks. Native before/after
  attribution for the earlier `45ef153` marker change remains unmeasured.

Earlier dated Mac performance reports describe earlier code, workloads and
visible counts. They are useful profiling history, not validation of `45ef153`.

## Next: incremental trails and stems

The [Mac follow-up](MAC_TRAIL_STEM_PROFILING_2026-10-28.md) measured stages first.
Ordering was inexpensive in its warmed native workloads. It therefore implemented
bounded sharing of current marker coordinates before pursuing topology caches.
Run/chunk reuse below remains future work; preserve the existing rebuild fallbacks.

The trail-enabled 100k sample improved only 7.13% including a render
(1432.1 → 1330.0 ms, three samples). That is indicative, not a reliable native
speedup claim. Trail/stem rebuilding is the next candidate to profile.

1. **Measure stages before changing representation.** Separate ordering,
   projection/simplification, coordinate conversion, stem/line construction and
   upload/submission time. Profile actual native playback with tracks, ground
   trails, stems and bloom enabled, plus effects-off comparisons. CPU submission
   does not measure GPU presentation waits.
2. **Cache entity/time/ID topology across packets.** Today `rebuild()` advances
   `generation`, invalidating ordering and geometry even for mostly overlapping
   data. Preserve stable ordering/connections and update changed membership,
   coordinates, timestamps, shapes or entity assignments. Handle reverse windows,
   source replacement and large jumps with explicit rebuild fallbacks.
3. **Reuse runs and then bounded chunks when valid.** Keep materials and meshes
   for unchanged selected edge sequences/positions. Start with map/non-elevated
   cases and run-level invalidation. Introduce chunks only after proving seams,
   overlap order, gaps, selection and simplification match the reference path.
   Batch stable and frequently changing sections in a few collections; do not
   create a draw collection for every edge or tiny chunk.
4. **Separate ground coordinates from time elevation.** Window changes can move
   every elevated vertex. Cache topology independently from positions first. A
   shared shader time transform is a later experiment if native profiling shows
   position uploads dominate; it is not part of the committed optimization.

### Constraints the implementation must preserve

`trailEdges()` uses screen-space Douglas–Peucker simplification with selected and
inferred anchors, clipping and temporal-gap rules. Changing a run endpoint can
change its entire simplified edge sequence; updating only the last edge is not
generally equivalent. Chunk-local simplification is not automatically equivalent
to the current whole-run result. Recompute/fall back when dependencies change.

Even ground-trail connectivity currently follows the edge sequence selected from
projected event positions. Stable ground coordinates alone do not prove that the
ground mesh is reusable after a time-elevation change.

Time elevation is reversed and clamped: newest at ground, oldest at the top, using
`1 - clamp((epoch - lo) / (hi - lo))`, or zero when `hi <= lo`. Preserve subsecond
precision, terrain datum/exaggeration, all three projections, picking and culling
bounds. Keep existing point/curve limits and share globe interpolation budgets
across chunks rather than granting each chunk a fresh full budget.

### Acceptance for the next change

- Paired measurements must include full trail/stem-enabled playback at 10k and
  100k, small-packet controls and actual scrub/play controls. Record event/entity
  counts, visible counts, window size, renderer, viewport/framebuffer, display
  settings, CLI profile and warmup. Compare final rebuilt artifacts.
- Preserve screenshots and exact picks/selection across chunk joins, selected
  endpoints, temporal gaps, inferred points, reverse scrub, large jumps, mode and
  height changes, hidden-layer camera changes, terrain updates and globe arcs.
  No new seams, bright joins, lingering segments or changed occlusion/order.
- Repeated cycles must show bounded retained bytes/vertices/objects, old-source
  collectability, cleanup on pause/replacement/recovery and no renderer errors.
- Retain the small-packet and globe rebuild fallbacks unless measurements and
  correctness checks support a change. Prefer fallbacks over silently reducing
  visual quality or raising evidence/curve budgets.
- Report median/tail frame intervals and visible freezes separately from CPU
  installation/upload counts. A gain in markers or a software microbenchmark is
  insufficient evidence of a native trail-enabled playback improvement.

## Implementation entry points

| File | Relevant area |
| --- | --- |
| [view.ts](../../frontend/src/view.ts) | `setData`, `rebuild`, `rebuildTrails`, `rebuildStems`, fade cohorts, `styleTrails`, `playbackMarkerPlan`, diagnostics |
| [display-math.ts](../../frontend/src/display-math.ts) | `trailEdges`, protected anchors, gaps and screen simplification |
| [cesium-geometry.ts](../../frontend/src/cesium-geometry.ts) | Geodesic interpolation and shared arc budgets |
| [time-axis.ts](../../frontend/src/time-axis.ts) | Reversed/clamped time-elevation mapping |
| [cesium-display-layer.ts](../../frontend/src/cesium-display-layer.ts) | Bloom/heat worker/atlas lifetime; preserve track-only independence |
| [playback-reuse-qa.mjs](../../frontend/scripts/playback-reuse-qa.mjs) | Paired/full-rebuild controls, marker identity, 21 view/fade states, memory cycles, edits and recovery |
| [track-style-qa.mjs](../../frontend/scripts/track-style-qa.mjs) | Ground/track visibility, globe ordering, cached geometry and bloom-slider tests |

See [testing](../TESTING.md), [native playback history](MAC_NATIVE_PLAYBACK_2026-10-17.md)
and the [Mac handoff](../handoffs/2026-10-28-renderer-performance-mac.md) before
collecting or interpreting new Mac results.
