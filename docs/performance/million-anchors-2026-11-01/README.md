# Million-event location anchor experiment

Local branch `experiment/million-location-anchors`, based on spatial baseline
`8571a67`. The unsuccessful display-aggregation candidate `49c6563` is excluded.
The benchmark's overview mode is reused from that branch as a measurement-only
utility. Main, Public and the installed Mac application are unchanged; no hosted
runners are used.

## Candidate and scope

`inferred_markers` first builds/samples the exact ordering of matching events
without locations or WKT geometries. Previously it then requested the full
located-event anchor ordering even when that missing-event count was zero.

When the exact missing-event count is zero, the candidate returns the same
empty sample, zero count and empty metadata without constructing an anchor
table. If that anchor ordering is already cached, it retains its existing LRU
priority: it may also be the canonical overview render ordering. A shared cache-key
helper keeps the lookup identical to ordinary ordering requests. Missing-event filtering and all
inference work for nonempty samples remain unchanged. It does not cache absence,
add indexes, change data precision, alter rendering budgets or modify source
records. No new ordering table is created on this shortcut.

This is expected to matter most for camera-bounded reads: their located render
ordering differs from the unbounded exact anchor ordering. An overview read can
already reuse its render ordering as the anchor ordering, so the same shortcut
may yield little improvement there. Avoiding an unused anchor ordering may also
leave more room in the four-entry ordering cache for repeated time windows.

The new tests verify that an empty inference read creates only the missing-event
ordering; later coordinate changes and filters can still produce exact inferred
positions and endpoint IDs. Engine edits, Undo/Redo and null source coordinates
are checked, together with preservation of a cached canonical ordering across
more distinct viewports than the cache has slots. Existing inference tests exercise missing endpoints, selected-only
scope, dateline interpolation and display budgets.

## Local reproduction

Preserve separate optimized CLI binaries for baseline `8571a67` and the candidate.
The UI control uses the same built frontend, fixed viewport, one-million-event
100-track fixture, bloom/tracks/trails, 20,000 representative points and two
profiled rounds:

```sh
CHRONOSCOPE_PERF_ROWS=1000000 \
CHRONOSCOPE_PERF_ROUNDS=2 \
CHRONOSCOPE_PERF_BUDGETS=20000 \
CHRONOSCOPE_PERF_CPU_PROFILE=1 \
CHRONOSCOPE_QA_RUST_PROFILE=release \
CHRONOSCOPE_CLI=/absolute/path/to/variant \
CHRONOSCOPE_PERF_OUT=/absolute/path/to/unused/output \
python3 scripts/guarded_run.py -- node frontend/scripts/performance-100k-qa.mjs
```

Measure complete bounded snapshots for six distinct 25%-width time windows,
followed by eight alternating reads of two adjacent windows and spatial probes:

```sh
python3 scripts/guarded_run.py -- python3 scripts/benchmark_refresh.py \
  --binary /absolute/path/to/variant \
  --project /absolute/path/to/million.chronoscope \
  --alternating-filters --spatial-probes --expected-count 1000000 \
  --output /absolute/path/to/unused/bounded.json
```

For overview requests, add `--overview` and omit `--spatial-probes`. Alternating
reads use the same second/third stepped windows as the cold sequence; the first
pair settles the caches and the final six calls measure repeated-window reuse.
The spatial sweep also performs a canonical overview read before and after
panning, to check whether the shortcut evicts useful render orderings.
The driver compares summaries and display/render/geometry packet hashes,
excluding revision/cache-hit metadata. Full profiles, reports, captures and
binaries remain ignored under `.qa/million-anchor-performance/`.

## Results

| Measurement | Baseline (`8571a67`) | Refined candidate |
| --- | ---: | ---: |
| Cold bounded snapshot, median across six time windows | 678.2 ms | 574.2 ms |
| Repeated adjacent bounded windows, median of final six reads | 330.4 ms | 50.1 ms |
| Canonical overview after viewport sweep | 1,208.7 ms | 1,204.8 ms |
| Overview UI filter median, round 1 | 739.8 ms | 745.3 ms |
| Overview UI filter median, round 2 | 733.0 ms | 733.4 ms |
| Navigation/playback | about 60 fps | about 60 fps |
| CSV import | 22.28 s | 22.49 s |
| Retained JavaScript heap | 42.50 MiB | 42.50 MiB |
| Guarded UI process-tree peak RSS | 3,731 MiB | 3,419 MiB |

Cold camera-bounded backend requests take **15.3% less time**. Repeated adjacent
bounded windows take **84.8% less time (6.60× faster)** after the initial pair
settles the ordering caches. Those are backend snapshot measurements, not
end-to-end filter interactions or frame-presentation measurements. The earlier
unbounded anchor table is no longer constructed when it is absent and unused,
leaving the repeated bounded windows' useful orderings in the four-entry cache.

Overview UI filtering is effectively unchanged: the median of round medians is
736.4 ms before and 739.35 ms after. Separate backend overview reads show 593.2 ms
before and 562.9 ms after for the cold sequence, and 50.9/49.7 ms for repeated
windows; those smaller differences do not establish a general overview speedup.
The overview path can already reuse the located render ordering as anchors.
No import, frame-rate or steady-state memory improvement is claimed. Both UI
runs pass exact million-event counts, 20,000-point representation and cell
membership, with no page/renderer errors or public map requests. Both remain
inside the guard's 5 GiB process-tree limit.

Preserving cached anchor priority is essential. A direct early return initially
improved bounded reads but made canonical refresh after the viewport sweep take
1,491.5 ms instead of 1,208.7 ms: the anchor ordering also served rendering and
was evicted. The refined shortcut touches existing entries using the shared key
builder, but never constructs a missing one. The final overview-after-panning
measurement is 1,204.8 ms, and a regression test checks that the original cached
table survives more distinct viewports than cache slots. Initial measurements
and the initial binary are retained separately under the ignored
`initial-shortcut/` evidence directory.

All 42 compared summary payloads and 140 display/render/geometry packet sections
match exactly between baseline and refined candidate, excluding revision and
cache-hit metadata. The bounded sweep includes global, broad, narrow, dateline
and polar viewports, together with canonical overview reads before/after the
sweep. [results.json](results.json) records timings, hashes, comparisons and the
initial shortcut's cache-regression result.

## Verification and limits

190 Rust tests pass across the library, new location-anchor cases, assistant
aggregation/inference, viewport planning, display LOD, playback, filter summaries,
geometry, coherent/native snapshots, render budgets, indexed SQL, hardening,
analytics, geospatial and table-selection cases. The shared cache-key extraction
preserves the existing key fields, including source, selection revision, sort,
viewport, display cell and table search.

```sh
python3 scripts/guarded_run.py -- cargo test --locked --lib \
  --test location_anchors --test assistant_aggregation --test viewport_planning \
  --test display_lod --test playback_display --test filter_summary \
  --test million_refresh --test wkt_wmts --test display_snapshot \
  --test native_snapshot_publication --test performance_display \
  --test performance_sql --test performance_regressions --test hardening \
  --test analytics --test geospatial
python3 scripts/guarded_run.py -- cargo test --locked --test table_selection
```

These are sequential local comparisons with uncontrolled OS cache state, a
synthetic fixture and two profiled UI rounds per variant. The cold backend
sequence spans six distinct time windows; repeated-window results concern the
two specified adjacent windows and do not establish general cache-hit rates.
Canonical refresh after the viewport sweep is a single control sample per
variant. UI measurements use Chromium/ANGLE Metal on Apple M5, not native
WKWebView presentation. Native desktop interaction timing and other real datasets
remain to be validated before broad performance claims or promotion.
