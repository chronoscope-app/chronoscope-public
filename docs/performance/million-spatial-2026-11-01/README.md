# Million-event adaptive viewport experiment

Local branch `experiment/million-spatial-performance`, based on filtering
experiment `d58c7d3`. This changes shared Rust query planning for point-only
workspace viewports. It adds no schema, product feature or rendering budget.
Main, Public and the installed Mac application are unchanged; no hosted runner
is used.

## Target and candidate

The previous experiment left display aggregation and point ordering as major
filter costs. A read-only SQL probe over the million-point fixture compared
RTree candidates with exact point predicates, retaining identical ordered rowids.
At a 25%-width time window, broad-view query times were 409–418 ms through RTree
and 70–71 ms with direct point bounds. A narrow viewport took 3 ms through RTree
versus 30 ms with direct bounds. An unconditional planner switch would regress
zoomed-in queries.

The candidate probes RTree density only up to one quarter of the dataset. For
broad point-only viewports it omits the redundant RTree rowid list and retains
the exact latitude/longitude predicate. Narrow views retain RTree pruning. Any
workspace containing WKT geometries retains the existing indexed path, avoiding
extra complex-shape intersection work. The common SQL builder still emits the
same exact point/geometry predicates and parameter ordering for the chosen path.

At most 32 viewport decisions are cached, independently of time/filter changes.
Data edits, imports and Undo/Redo clear the decisions through existing store
cache invalidation. Workspace replacement gets a new store. First use of each
uncached viewport pays a bounded density-probe cost; subsequent requests reuse
that decision. Existing spatial filters and exact display-cell membership keep
their original indexed queries.

## Local reproduction

Preserve separate optimized CLI binaries for baseline `d58c7d3` and the candidate.
Use the same built frontend and synthetic fixture as the previous experiments:
100 tracks, one million stored events, 20,000 representative points, bloom,
tracks and trails, fixed viewport and two profiled UI rounds.

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

Measure backend phases and cold/repeated viewport calls on the same portable
synthetic input, without changing the input:

```sh
python3 scripts/guarded_run.py -- python3 scripts/benchmark_refresh.py \
  --binary /absolute/path/to/variant \
  --project /absolute/path/to/million.chronoscope \
  --filter-phases --spatial-probes --expected-count 1000000 \
  --output /absolute/path/to/unused/phases.json
```

The driver records summary values and SHA-256 hashes of display/render/geometry
packets (excluding revision/cache-hit metadata) for comparison between binaries.
Viewport probes include global, broad, narrow, dateline and polar bounds, each
called twice; the world viewport decision is already warm from the earlier
filter phases. Omit both `--filter-phases` and `--spatial-probes` for the separate
complete cold bounded-snapshot comparison across six time windows.
Full raw reports, profiles, captures, query plans and binaries are
ignored local evidence under `.qa/million-spatial-performance/`.

## Results

A separate run measures the complete cold camera-bounded snapshot request as
one operation: its median across six 25%-width time windows falls from
**1,281.2 ms to 669.1 ms (47.8% less waiting; 1.91× faster)**. Those complete
requests also return identical summaries and packets between binaries. This is
a backend RPC measurement of the camera-update path, not an end-to-end UI
filter latency or native presentation measurement.

Separate cold filter phases, using whole-world bounds and six 25%-width time
windows, produced these medians:

| Phase | Baseline (`d58c7d3`) | Candidate |
| --- | ---: | ---: |
| Sidebar summary | 150.4 ms | 150.0 ms |
| Display aggregation | 480.1 ms | 200.9 ms |
| Point packet | 655.7 ms | 319.0 ms |

All 13 recorded summaries and 59 display/render/geometry packet sections match
exactly between binaries. The packet comparison covers the six time windows and
additional global, broad, narrow, dateline and polar requests, with repeated
calls for each viewport. Repeated narrow point requests are about 0.9 ms in both
variants. The first narrow point request increases from 6.5 ms to 8.3 ms. The
first empty dateline request increases from 47.8 ms to 84.7 ms; these requests
also include ordered-cache construction/eviction, and this comparison does not
isolate the density-probe cost. Repeated empty dateline requests are about 0.2 ms
in both variants. These first-use samples remain a limitation to examine during
further pan/zoom testing.

The existing overview UI benchmark is a control and shows **no improvement**:
its two filter round medians are 749.3/718.1 ms before and 742.0/732.1 ms after.
The canonical overview refresh does not pass camera bounds, and the harness
suppresses camera-change callbacks. This optimization therefore does not change
that path. Repeated overview refresh remains about 65–68 ms, navigation/playback
about 60 fps, and CSV import about 22.5 s. Both UI variants pass exact counts,
20,000-point budgeting and cell-membership checks with no renderer/page errors
or public map requests.

Retained JavaScript heap is about 42.5 MiB in both variants. Guarded UI process-tree
peak RSS is 3,972 MiB before and 4,139 MiB after; no memory improvement is claimed.
Measurements use the same frontend bundle and Apple M5 Chromium/ANGLE Metal
renderer, with two profiled rounds per variant and uncontrolled OS cache state.
They are not native WKWebView frame-presentation certification or general tail
latency guarantees. The density cutoff is a heuristic tested on this synthetic
workload; mixed-shape workspaces deliberately retain their existing planner.

## Correctness verification

166 Rust tests pass across the library, new viewport tests, display LOD, playback
preferences, filter summaries, geometry fast paths, coherent/native snapshots,
render budgets, indexed SQL, hardening, analytics, geospatial and WKT/WMTS tests.
New tests compare adaptive point queries with the original indexed SQL across
selected-only, temporal, search, hidden-source and spatial-filter intersections,
including exact IDs above 2^53, missing locations, poles and dateline crossings.
Mixed-geometry fixtures exercise long lines, split dateline lines, canonical WKT
points and polygon holes. Every returned display cell retains exact membership.
The planner test checks density, the WKT guard, data invalidation and the 32-entry
memo limit.

[results.json](results.json) records binary/source hashes, all phase timings,
viewport samples, packet/summary comparison hashes, the complete bounded-read
measurements and the overview UI control.

Final verification command:

```sh
python3 scripts/guarded_run.py -- cargo test --locked --lib \
  --test viewport_planning --test display_lod --test playback_display \
  --test filter_summary --test million_refresh --test wkt_wmts \
  --test display_snapshot --test native_snapshot_publication \
  --test performance_display --test performance_sql \
  --test performance_regressions --test hardening --test analytics --test geospatial
```
