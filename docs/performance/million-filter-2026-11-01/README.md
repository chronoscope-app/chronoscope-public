# Million-event filter-summary experiment

This local experiment builds on geometry fast-path commit `7a453fc`, on branch
`experiment/million-filter-performance`. It changes shared Rust summaries, not the
frontend renderer or the portable database schema. Main, Public and the installed
Mac application are unchanged. No hosted runners are used.

## Target

The previous experiment improved repeated refresh but left time filtering around
0.9 seconds. A phase probe with six distinct 25%-width time windows found cold
summary reads around 268–302 ms, display aggregation around 486–496 ms and bounded
point-packet construction around 640–685 ms. These are separate sequential phases
with whole-world bounds, not additive estimates of the camera-bounded UI latency.

A read-only SQL probe isolated repeated global entity/category grouping and a
source-layer query that scans all million events and tests membership in the
filtered ordering. Source-layer counting alone took 129 ms; grouping the 250,000
matching rows by source took 39 ms. Global entity/category grouping added 42 ms.

## Candidate

Cache dataset-wide entity/category/source totals until the store changes. Compute
per-source visible counts from the exact filtered ordering, then combine them
with global source totals. Preserve global source ordering, the existing
5,000-source limit, hidden-source flags, empty layers and selected-only filters.

The new totals share the existing 8 MiB encoded-summary cache budget; oversized
dictionaries are returned correctly without retention. Data edits, bulk loads,
Undo/Redo and workspace replacement invalidate the totals. Filter and selection
changes retain only the dataset-wide totals; filtered counts remain exact.

## Local reproduction

Preserve separate optimized CLI binaries for `7a453fc` and the candidate. Use the
same built frontend and the existing million-event synthetic workload described
in [the first experiment](../million-event-2026-11-01/README.md).

For each variant:

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

Split backend phases on an existing synthetic portable input with:

```sh
python3 scripts/guarded_run.py -- python3 scripts/benchmark_refresh.py \
  --binary /absolute/path/to/variant \
  --project /absolute/path/to/million.chronoscope \
  --filter-phases --expected-count 1000000 \
  --output /absolute/path/to/unused/phases.json
```

The phase driver records summary values as well as timings, allowing exact
baseline/candidate comparison of counts, dictionaries, histograms and layers.

## UI results

| Measurement | Baseline (`7a453fc`) | Candidate |
| --- | ---: | ---: |
| Filter + refresh median, round 1 | 876.6 ms | 743.7 ms |
| Filter + refresh median, round 2 | 866.5 ms | 732.8 ms |
| Repeated refresh median, round 1 | 68.2 ms | 67.8 ms |
| Repeated refresh median, round 2 | 66.4 ms | 66.8 ms |
| Focus / orbit / playback | about 60 fps | about 60 fps |
| CSV import | 22.80 s | 22.60 s |
| Retained JavaScript heap | 42.50 MiB | 42.61 MiB |
| Peak guarded process-tree RSS | 3,085 MiB | 4,078 MiB |

The median of the two filter round medians improves from 871.55 ms to 738.25 ms:
**15.3% less waiting (1.18× faster)**. Repeated refresh and navigation are unchanged.
Both runs pass exact million-event, representative-budget and exact-cell-membership
checks, with no renderer/page errors or public map requests. This is a latency
improvement, not a memory improvement; the candidate's measured process-tree peak
is higher. Both stayed within the resource guard's 5 GiB process-tree limit.

Both variants use the same built frontend, viewport, 20,000-point representative
budget, bloom/tracks/trails, hardware Chromium/ANGLE Metal renderer on Apple M5,
and two profiled rounds. Large profiles, raw reports, generated inputs and
binaries remain ignored under `.qa/million-filter-performance/`.

These are sequential local A/B measurements with an uncontrolled OS page cache
and a synthetic dataset. They do not establish general tail latency or native
WKWebView/GPU presentation behavior. Display aggregation and spatially bounded
point ordering remain significant filter costs; this candidate does not change
them. Import, save and reopen are not optimized by this change.

The final backend phase comparison reduces the median cold summary read from
286.5 ms to 152.1 ms (47% less time). Display aggregation remains about 482–483 ms
and point-packet construction about 659–661 ms with whole-world bounds. All 13
recorded summary payloads match exactly between binaries, including global counts,
entity/category dictionaries, histograms, visible counts, layers and statistics.
[results.json](results.json) records timings, binary/source hashes and the summary
comparison hash. The original million-event fixture is reused unchanged.

## Correctness verification

132 Rust tests pass across the library, analytics, filter-summary regressions,
hardening, the earlier geometry fast path, coherent display/native snapshots,
render budgets, SQL indexing, WKT and performance regressions. New coverage
compares layer results against the original full-scan SQL through cache eviction,
hidden sources, empty windows and selected-only filtering; checks dataset edits,
Undo/Redo, deletion, append and reopening; and preserves the 5,000-source limit
when only sources beyond that limit are visible.

Validation command:

```sh
python3 scripts/guarded_run.py -- cargo test --locked --lib \
  --test filter_summary --test million_refresh --test wkt_wmts \
  --test display_snapshot --test native_snapshot_publication \
  --test performance_display --test performance_sql \
  --test performance_regressions --test hardening --test analytics
```
