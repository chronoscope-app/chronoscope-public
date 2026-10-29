# Retain rendering resources during selection and styling

This change reduces repeated CPU work and GPU uploads in the existing Cesium
renderer. It keeps the current event/track limits and does not establish a
million-entity performance guarantee.

## Changes

- Selection updates preserve the shared vertical-stem primitive. Normal point
  display looks up selected glyphs directly; summary display patches the union
  of old and new selected IDs rather than scanning the entire event collection.
  Selection overlays retain canonical packet order, including coincident picks.
- Stem visibility and opacity use the existing primitive and one shared material.
  Its color is quantized to the original normalized-byte representation so that
  switching to a uniform does not change the intended stem brightness.
- Marker rebuilds with the same ID order and glyph shapes patch existing glyphs.
  Moving-window playback keeps its existing arrival/departure batching and fade
  behavior. Reordered evidence, shape changes and changed membership rebuild
  canonical collection order. Projection, terrain, height and timestamp changes
  still update positions.
- Track sorting is retained for the current event generation. Camera, selection
  and opacity changes still recompute screen-dependent simplification, using the
  same entity/time/ID ordering, gap rules and 100,000-input-point limit.
- New diagnostics expose marker builds/reuses, stem geometry builds and track
  sorts. Context recovery resets scene-owned references; disposal releases the
  cached track order.

## Local verification

The new `renderer-reuse-qa.mjs` creates an isolated instance of the production
renderer through the real local Rust bridge. Its 10,000- and 100,000-event
fixtures contain 100 entities, inferred triangles, centroid flags and IDs above
JavaScript's exact integer range. It checks actual primitive/glyph identity,
WebGL upload bytes, selection/summary behavior, style updates, camera ordering,
time-height invalidation, packet reordering and shape changes. It renders fixed
400-event fixtures in time, map and globe views for canvas comparison.

Comparison baseline: `1211acf` with its original `frontend/src/view.ts`, built
with the same local dependencies and QA fixture. The final candidate also
integrates `174b403` (application globe-elevation input reconciliation); the
isolated renderer fixture does not use those application controls. Both builds
use the same Rust bridge. Chrome runs with SwiftShader at 1400 × 900, device
scale 1, using bundled imagery and no public map requests. Tracks and stems are enabled. Bloom is off
in the isolated resource measurement; the existing effects suite covers it
separately. Measurements are short synthetic CPU/upload observations, not
physical GPU frame rates, native WebKit performance or battery-life evidence.

The selection interval performs eight successive single-event selections,
followed by an actual render. CPU duration covers the selection calls, while
buffer bytes count allocation/upload calls to `bufferData` and `bufferSubData`
during selection and the render; this is not measured bus traffic. These describe
this specific operation, not whole-application uploads.

Commands (from the repository root; select an installed Chromium executable):

```sh
CHRONOSCOPE_CHROMIUM=/path/to/chrome python3 scripts/guarded_run.py -- \
  python3 scripts/validate_local.py \
  --suite renderer-reuse --suite cesium-parity --suite cesium-effects-pixels \
  --suite cesium-globe-time --suite cesium-context --suite cluster-identity \
  --rust-test display_lod --rust-test map_presets --browser-jobs 1
```

The shared test inventory also registers three tests already present in the
baseline (`scene-ack`, `scene-transitions`, `view-snapshot`); their missing
registrations previously prevented the shared validation entry point from
starting. No dependencies or hosted workflow triggers are changed.

The effects fixture explicitly selects its expected English month/24-hour display
formats. Its prior reliance on system formats timed out at the existing `Oct`
axis assertion on numeric-date hosts, after its heat/bloom pixel checks passed.

The persistent-afterimage fixture now derives its wait intervals from the
renderer's declared departure lifetime. Its two old 450 ms waits exceeded Next's
800 ms lifetime and asserted retention after expiry. Both retention before
expiry and removal after expiry remain required.

## Measured selection and visual results

One paired synthetic observation, eight selection calls per row. Sub-millisecond
values are limited by browser timer resolution; these are not statistical
confidence intervals or an end-to-end UI latency benchmark.

| Events | Baseline selection CPU / ms | Candidate selection CPU / ms | Baseline WebGL buffer bytes | Candidate WebGL buffer bytes |
| --- | ---: | ---: | ---: | ---: |
| 10,000 | 71.1 | 0.4 | 1,044,120 | 5,160 |
| 100,000 | 568.7 | 0.2 | 10,389,696 | 96 |

The fixed 400-event time, map and elevated-globe canvas comparisons each contain
1,260,000 pixels. All three have **zero changed pixels** against the baseline
after matching the original stem color precision. This verifies these scenes,
not every possible terrain, display setting or GPU.

The final resource fixture passes on the integrated Next source, including
canonical overlay order and exact selection IDs. See the
[portable measurement summary](renderer-resource-reuse-20261028.json).

The afterimage fixture renders on demand during lifetime assertions and waits
for the scheduled fade animation callback before inspecting opacity. The
separate real-frame upload test remains enabled. These fixture changes avoid
confusing software-renderer frame cost or unsampled animation state with a
change to the production fade duration.

Final local checks passed: Rust formatting, core Clippy, 10 integration tests
across `display_lod`/`map_presets`, the production frontend build, generated
contracts, all 29 frontend test files, and the six browser suites listed above.
The parity suite completed all 21 checks, including exact selections, fades,
import previews, undo/redo and polar picking. Its import-preview fixture also
pins ISO dates and 24-hour time to match its existing canonical timestamp
assertions. No GitHub Actions or hosted runners were used.
