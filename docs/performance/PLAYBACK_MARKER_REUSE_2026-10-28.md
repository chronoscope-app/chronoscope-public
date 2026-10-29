# Incremental markers during moving-window playback

Playback packets with at least 256 visible markers now retain overlapping
markers instead of clearing all four Cesium marker collections on each changed
packet. Smaller packets retain the original canonical rebuilding path. Departures become hidden resident
slots; arrivals append to the existing small arrival collections. Completed
arrivals move into the ordinary collections when their canonical order permits.
Opaque playback uses the same incremental path with fades disabled; time-only
opaque packets retain their existing resident fast path without delta planning
or copying the old packet.

Existing arrival/departure clocks, separate unpickable afterimages, inferred
triangles, selection overlays and canonical collection order remain in use.
Map/globe-without-time packets also skip recalculating unchanged marker positions.
Time-elevated views still recalculate positions when their time bounds change.
Axes, geometry features, stems, trails, packet decoding and backend queries still
take their existing paths. This is incremental marker installation, not a claim
that the whole playback pipeline now does work proportional only to the delta.

## Ordering and retained memory

Before patching, the renderer verifies that surviving markers remain in relative physical
collection order and new markers append after them. Reordering or inserting
before a survivor takes the canonical rebuild path, preserving overlapping
colors and picks. This can limit gains during reverse scrubbing or arbitrary
packet reordering. Pausing consolidates markers into ordinary canonical order.

Resident slots are compacted before exceeding the current visible packet count
plus the larger of 4,096 or 25% of that count, with a 200,000-slot budget ceiling
for the supported packet sizes. Empty windows clear all marker slots. Thus a
100,000-marker packet allows at most 125,000 resident slots between compactions.
This bound excludes the separately bounded departure-afterimage collections.
Graphics recovery resets arrival membership metadata. The existing canonical
ordering map also tracks relative collection order, avoiding an additional
per-marker slot map. Diagnostics distinguish current marker counts from allocated
slots and report patch/reuse, order-fallback and compaction counts.

## Verification and measurement

The local `playback-reuse-qa.mjs` suite uses the production frontend and real
local Rust bridge with an isolated renderer. It checks:

- 10,000 and 100,000 events in map and space-time views, with 0.5% of events
  entering and leaving each packet. Each of three trials installs six packets
  and explicitly renders each one. Both builds receive the same synthetic
  90 ms packet clock; elapsed CPU measurements use the original monotonic clock.
- Marker object identity across overlapping packets and diagnostics proving
  that forward time-ordered packets use the incremental path.
- 21 controlled images across time/map/globe, including arrival midpoint,
  expired departures, reverse scrub, reordered coincident events, pause and
  fades disabled. Pick results are compared alongside pixels.
- Exact live marker IDs, positions, shapes, counts and selection; departure
  afterimages must not remain pickable. A reorder must exercise the fallback.
- 150 rendered 2,000-event windows, forcing compaction, measuring tracked WebGL
  buffers and post-GC heap, and checking that replaced source objects can be
  collected. Pausing must release dormant slots.
- Field/shape edits, centroid visibility, empty windows and graphics recovery.

The existing playback-transition suite additionally exercises actual playback
controls with bloom enabled and verifies that real application packets use the
adaptive marker path. It checks presentation cadence, bounded atlas crossfades,
pause settlement and the full-range no-refresh path. Other focused suites cover
playback speeds, existing fade/selection behavior, context recovery and earlier
renderer-resource reuse. Software control runs use 1100 × 700; opt-in hardware
runs retain 1600 × 1000 and enforce the original ≥20 updates / <180 ms median
cadence thresholds. Software runs record cadence and require repeated real
presentations, correct crossfades and pause settlement. The original large
software viewport missed the cadence threshold in both baseline and candidate
runs, so it does not establish a native playback FPS regression or improvement.

A same-bundle control comparison isolated a real small-batch drawback: resident
updates presented 14 packets versus 26 with forced canonical rebuilding at the
same 1100 × 700 viewport. The adaptive fallback then presented 29 packets; the
old frontend presented 27. Later runs of the same adaptive build varied from
16 to 29 updates. These
samples motivated retaining the established small-batch path, but do not
establish a reliable end-to-end/native FPS regression or speedup. Strict
cadence assertions are therefore hardware-only; software timings remain in
the report alongside the functional assertions. The full-size
hardware path remains available for native performance validation.

Baseline is Next `c664af5`. Measurements use local Chrome/SwiftShader at
1400 × 900, scale 1. Isolated timing excludes queries, transport and application
UI scheduling. Packet-plus-render durations include an explicit Cesium render
but do not establish physical-GPU/native WebKit FPS. Buffer bytes count
`bufferData`/`bufferSubData` allocation/upload arguments, not bus traffic or total
GPU work. The small trail-enabled sample is reported separately rather than
being presented as the marker-only gain. Separate paired measurements
alternate forced canonical rebuilds and reuse within the same warmed browser,
reversing trial order, to distinguish smaller gains from cross-process noise.

```sh
CHRONOSCOPE_CHROMIUM=/path/to/chrome python3 scripts/guarded_run.py -- \
  python3 scripts/validate_local.py \
  --suite playback-reuse --suite playback-speed --suite playback-transitions \
  --suite cesium-parity --suite cesium-context --suite renderer-reuse \
  --rust-test playback_display --rust-test display_lod --browser-jobs 1
```

For before/after runs, preserve the baseline production bundle and set
`CHRONOSCOPE_QA_FRONTEND` plus `CHRONOSCOPE_PLAYBACK_BASELINE=1` for the baseline.
Fresh controlled image runs can use `CHRONOSCOPE_PLAYBACK_VISUAL_ONLY=1`.
Use `CHRONOSCOPE_PLAYBACK_PAIRED=1` for the paired 10k/100k comparison and
`CHRONOSCOPE_PLAYBACK_LOAD_ONLY=1` for the full-dataset installation check.
All verification runs locally; hosted workflows remain manual-only.

See [portable measurements](playback-marker-reuse-20261028.json) for raw samples,
scope, source hashes, memory evidence and image/pick comparisons.

## Results

The paired comparison alternated forced canonical rebuilding and reuse within
one warmed candidate browser (same code, scene and logical packet clock):

- 10,000 events, map: installation 21.80 → 14.90 ms (31.65% reduction); including a render 35.65 → 24.05 ms (32.54% reduction).
- 10,000 events, space-time: installation 20.00 → 17.80 ms (11.00% reduction); including a render 33.25 → 33.20 ms (0.15% reduction).
- 100,000 events, map: installation 207.05 → 148.00 ms (28.52% reduction); including a render 317.45 → 209.00 ms (34.16% reduction).
- 100,000 events, space-time: installation 220.90 → 162.35 ms (26.50% reduction); including a render 337.45 → 228.50 ms (32.29% reduction).

The paired measurements above are the preferred comparison for isolating
marker reuse. They alternate paths within one browser to reduce the
cross-process variation seen in the following baseline/candidate runs.

Median of 18 packet installations per size/view (three trials × six packets).
Markers and axes are enabled; tracks and ground trails are disabled in this table.

| Events | View | Packet installation / ms, before → after | Reduction | Packet + render / ms, before → after | Reduction |
| --- | --- | ---: | ---: | ---: | ---: |
| 10,000 | map | 16.2 → 20.2 | -24.61% | 29.1 → 33.4 | -14.61% |
| 10,000 | space-time | 18.9 → 24.2 | -28.65% | 28.6 → 41.6 | -45.45% |
| 100,000 | map | 302.1 → 177.1 | 41.39% | 418.0 → 246.3 | 41.06% |
| 100,000 | space-time | 309.1 → 149.2 | 51.72% | 462.8 → 222.8 | 51.86% |

With tracks and ground trails enabled at 100,000 events, the separate
three-packet sample measured 998.7 → 947.7 ms for
installation (5.11% reduction) and 1432.1 → 1330.0 ms including
a render (7.13% reduction). This smaller, indicative sample includes
unchanged trail/stem rebuilding costs and is not an overall FPS claim.

Smaller cross-process samples varied enough to reverse the apparent gain in
some runs. The paired result supports a modest small-scene benefit, with much
less improvement when time-position uploads/rendering dominate.

Forward packets reused approximately 99.17% of live marker objects across the
six-packet fixture, avoiding their recreation. Departing afterimages, geometry
buffers and other scene objects are accounted for separately.

At 100,000 events, the median six-packet buffer allocation/upload count fell
by 13.759% in map view. In space-time it increased by 2.536%: retained
hidden slots are included when changing time elevations rewrites positions.
This bounded extra buffer work accompanies the reduced CPU installation cost;
it is not a promise of reduced GPU work in every view.

All 21 fresh controlled images (1,260,000 pixels each) and coincident pick
orders match the baseline exactly. The 150-window memory run reached
6,080 resident slots for a 2,000-event window, compacted 1 time(s), and
returned to 2,000 slots on pause. Tracked affected WebGL buffers peaked at
596,220 bytes and ended at 201,616 bytes after pause;
post-GC heap changed by 246,656 bytes. Replaced source points were
collectible. These are bounded-cycle and affected-buffer checks, not total
browser/driver memory accounting or an indefinite leak guarantee.

A separate three-trial full-dataset install check (empty packet → 100k) measured:

- map: data installation 261.7 → 265.1 ms; including fit and two renders 441.3 → 434.2 ms.
- space-time: data installation 211.0 → 182.0 ms; including fit and two renders 609.1 → 663.6 ms.

These small load samples document bookkeeping/startup cost separately from the
repeated-playback gains; they are not full application-launch timings.

Final focused local verification passed: production build, contracts, formatting,
core Clippy, 13 relevant Rust integration tests, all 29 frontend test files and
six browser suites across focused runs. The final source passed the adaptive
control and full playback-reuse suites; earlier runs passed the renderer parity,
context, speed and resource-reuse suites. Actual playback controls exercised
the small-batch fallback,
while bloom crossfades, pause settlement and full-range no-refresh behavior
remained correct. No hosted workflows ran.

## Next work and Mac handoff

The next proposed step is incremental trail/stem geometry: profile sorting,
simplification, position conversion, construction and uploads; cache stable
entity/time/ID topology; then reuse unchanged runs or bounded chunks. Time-window
changes can move all elevated vertices and change screen-space simplification,
so updating only boundary edges is not generally sufficient. A shared GPU time
transform is a later experiment if profiling warrants it.

This next step is not implemented. The [Next performance report](NEXT_PERFORMANCE_REPORT.md)
collects completed changes, limits, the staged plan and user-visible acceptance
criteria. The [Mac Codex handoff](../handoffs/2026-10-28-renderer-performance-mac.md)
contains checkout/build commands, Chrome/Metal versus WKWebView validation,
native profiling precautions, evidence requirements and a copy-ready task brief.
