# Mac trail/stem profiling and current-position reuse

2026-10-28. Runtime change: `12d9052`; reproducible profiling baseline: `982e38e`.
Started from Next/main `b3f8ec8`, including the renderer work through `45ef153`.
All builds, browser checks and native measurements ran locally. No hosted runner
or public promotion was used.

The Mac native renderer now shares current marker positions with stems and trail
projection during the same synchronous refresh. Native measurements support a
modest reduction in these CPU stages. This report does **not** establish an
overall FPS, asynchronous GPU, battery or million-entity improvement.

## Measurement setup

- Apple M5, Mac17,4, 16 GiB; macOS 27.0.1 (26A434), Xcode 27.1 (27A9275),
  Rust 1.99.0, Node 24.22.1. Native app: local debug Tauri/WKWebView, ad hoc signed.
- Native WebGL reports `Apple GPU`, vendor `Apple Inc.`, WebGL 2.0. Viewport:
  1238 × 892 CSS pixels; framebuffer 1857 × 1338; resolution scale 1.5.
- Chrome 156.0.8078.48 reports `ANGLE Metal Renderer: Apple M5`. The isolated
  paired fixture uses a 1400 × 900 viewport/framebuffer and resolution scale 1.
  Chrome and WKWebView are separate measurements.
- The handoff's portable fixture contains **100 entities and 100,000 Events**.
  Native moving windows target about 10,000 or 25,000 markers; minute-boundary
  phases can change membership by one 100-Event timestamp cohort. The growing
  window draws varying larger counts; its actual before/after counts are in the JSON.
  A 100k dataset or budget does not establish 100k simultaneously drawn markers.
  Counts describe live renderer packets; overlap and occlusion can hide pixels.
- Native cases enable tracks, ground trails and stems where applicable, use
  two-pixel simplification, dark appearance, no terrain and `basemap:none`
  (the packaged background remains visible). The 25k moving/growing cases enable
  bloom. Map has no time-elevation stems. Exact cameras/options accompany each run.

The order was baseline, candidate, baseline, final candidate. Each case warms up,
then runs the real UI clock for about 25 seconds at speed 2 and a one-hour
increment. This covers several moving-window cycles. Status is sampled outside
the timed interval; bounded `view_profile` records each Cesium render. Captures
are taken after the trace. No GPU test or compilation runs concurrently.

## Matched native observations

Stage means pool the two baseline runs and two candidate runs by call count.
Counters include pause settlement. They measure ordering, screen projection/
simplification, coordinate conversion and construction separately; actual GPU
uploads execute later during rendering. WebKit clock granularity makes tiny
individual calls noisy, so the JSON retains totals and call counts.

| Nominal visible Events / mode | CPU stage | Baseline mean (ms) | Mac reuse mean (ms) | Reduction |
| --- | --- | ---: | ---: | ---: |
| ~10k Space-time | Projection/simplification | 2.681 | 2.630 | 1.9% |
| ~10k Space-time | Stem coordinates | 0.641 | 0.513 | 20.0% |
| ~25k Space-time + bloom | Projection/simplification | 7.212 | 7.191 | 0.3% |
| ~25k Space-time + bloom | Stem coordinates | 1.761 | 1.591 | 9.6% |
| ~10k Map | Projection/simplification | 5.120 | 4.832 | 5.6% |

The stem-coordinate reductions are about 0.13 ms per 10k rebuild and 0.17 ms per
25k rebuild. Projection changes in Space-time are small. Unchanged ordering stages
also varied; their raw values remain in the JSON and are not attributed to this change.

| Native render-interval p95 (ms) | Baseline 1 / 2 | Candidate 1 / 2 |
| --- | ---: | ---: |
| 10k Space-time | 36 / 36 | 35 / 35 |
| 25k Space-time + bloom | 32 / 30 | 30 / 30 |
| Growing Space-time + bloom | 25 / 24 | 24 / 24 |
| 10k Map | 37 / 37 | 33 / 38 |

The growing-window run is a functional/stall observation rather than a normalized
stage-speed comparison: wall-clock scheduling changes the visible counts and
phases. Raw render intervals, CPU submission samples, long gaps and actual counts
are preserved in [portable evidence](mac-trail-stem-20261028.json).

The earlier exploratory native pass restored the portable project's saved map
and appearance. Its larger apparent stage differences are excluded from the
matched comparison. Warmed, controlled runs show smaller gains. Native render
interval medians remain near the display cadence; these traces do not measure
physical compositor presentations or isolate GPU execution.

## Why the change is limited to native macOS

Full trail/stem paired tests at 10k and 100k alternated canonical conversion and
position sharing in one warmed Chrome/Metal browser. The revised prototype's
100k, two-pixel-simplified map installation median regressed from 236.25 to
256.85 ms; packet-plus-render time regressed from 292.80 to 317.35 ms. The 100k
Space-time case also regressed. Unsimplified and earlier prototype observations
are retained in the JSON; they are not counted as native gains.

Consequently, the production default enables sharing only when the existing
native bridge is present on macOS. Browsers and other native platforms retain
canonical position conversion. Correctness fixtures explicitly exercise the Mac
path in Chrome, and a separate assertion verifies the browser default is off.
The native final run verifies actual sharing without a test override.

The change keeps no coordinate cache across packets. Markers are installed first;
stems and trail projection can borrow their current coordinates until the refresh
finishes. Track geometry receives owned copies. A `finally` block ends sharing,
and duplicate IDs disable it for the entire packet. Camera-only refreshes,
hidden-layer activation and calls outside this scope recompute positions.

Whole-run simplification, selected/inferred anchors, gaps, reversed/clamped time
heights, terrain/datum handling, picks, draw order, globe budgets, separate fade
cohorts, the small-marker fallback and the individual globe-layer rebuild fallback
retain their existing paths. There is no new point collection or retained source
cache.

## Validation and retained failures

- Initial Next baseline: release CLI/frontend builds, Clippy/contracts, 13 Rust
  integration tests (`display_lod`, `map_presets`, `playback_display`), 146 frontend
  tests, and the eight browser suites in the Mac handoff passed.
- Final runtime: builds/contracts/Clippy, 146 frontend tests and all eight browser
  suites passed. Renderer/style/playback fixtures force the Mac path, including
  hidden camera/data changes, height, terrain, selected anchors, gaps, globe curve
  budgets, recovery, repeated visibility cycles and old-source collectability.
- The paired check verifies exact canonical trail coordinates across 36 moving
  packets for each of 10k/100k Map/Space-time, plus exact settled trail/stem/marker
  pixels. The native baseline/candidate passes exercise actual play/pause, moving
  and growing windows, bloom, captures and per-frame traces.
- The final native control pass additionally verified reverse seeks/large jumps,
  zero height, hidden-camera reentry, empty-window cleanup and a full **100k
  marker / 100k stem installation**, all with zero render errors. The small bloom
  control starts with 20 Events, pauses with 19 in its moved window, records 191
  render samples and exercises the below-256 canonical marker fallback. These are
  native functional checks, not a 100k moving-window speedup measurement.
- Initial paired captures differed because playback histories and billboard
  uploads were unsettled. A subsequent canonical-to-canonical control isolated
  28 axis-label pixels differing by one channel value. The final isolated fixture
  hides axis labels in **both** variants and waits animation frames for uploads;
  all remaining pixels must match exactly. Ordinary visual suites and native
  captures retain labels. The failed attempts remain in ignored `.qa`.
- The first native harness attempt requested a readiness timeout above the
  discovered schema maximum. It was corrected before collecting timed data.

These checks do not measure indefinite native memory growth, total GPU memory,
native buffer traffic or presentation-fence costs. The source reuse introduces
no additional per-Event retained cache; browser lifetime checks remain bounded
tests rather than a proof against every future leak.

## Reproduce and continue

Use the [Mac handoff](../handoffs/2026-10-28-renderer-performance-mac.md) to build
and generate the portable fixture. Place its copy under the disposable profile's
`agent-files` directory, then run the committed harness against that app:

```sh
python3 scripts/guarded_run.py -- python3 scripts/native_renderer_performance_qa.py \
  --cli target/debug/bundle/macos/Chronoscope.app/Contents/MacOS/chronoscope-desktop \
  --profile .qa/mac-renderer-native-profile \
  --dataset .qa/mac-renderer-native-profile/agent-files/tracks-100k.chronoscope \
  --output .qa/mac-native-new-run --expect-position-reuse
```

Use `--controls-only` with a separate output directory to repeat the native
reverse/empty/full/small-bloom controls without the four timed cases.
For a baseline build at `982e38e`, omit `--expect-position-reuse`; use a separate
clean checkout/build artifact and the same disposable-profile type and settings.

For the isolated paired correctness/performance control, use the handoff's
release CLI and Chrome/Metal environment with `CHRONOSCOPE_PLAYBACK_TRACKS_PAIRED=1`
and `CHRONOSCOPE_PLAYBACK_TRAIL_PIXELS=2` when invoking
`frontend/scripts/playback-reuse-qa.mjs`. Use fresh output directories. This
deliberately forces the Mac path in the fixture; its timings do not describe the
production Chrome default. Setting trail pixels to zero retains the unsimplified
control. `CHRONOSCOPE_PLAYBACK_PAIRED=1` still runs the earlier marker-only control.

The new `trackCpuStages` and graphics diagnostics provide the next starting point.
Sorting was a small part of these warmed native cases, so topology-cache work
was deferred. Run/chunk geometry reuse and a shader time transform remain planned,
with the handoff's simplification, shared-budget, fade and visual safeguards.
Profile remaining installation/submission and GPU waits before changing that
representation. This Mac result does not validate earlier Linux marker gains as
native FPS gains.
