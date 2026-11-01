# Million event performance experiment

Local branch: `experiment/million-event-performance`, based on Next main
`ef5efe5850747e16f5e29f99ad24411a5b1c9e1b`. This is a local experiment for review.
No push, Public promotion, hosted runner, or Mac application rebuild/install was performed.

One million Events were imported and checked exactly. The interactive workload
uses 100 synthetic tracks with 10,000 timestamped points each, five categories,
tracks, stems, bloom, and a 20,000-marker representative budget. It does not draw
one million individual markers. The same built frontend, viewport (1800×1100),
settings, two rounds and CPU profiler were used for both optimized Rust binaries.
The renderer reported Apple M5 through Chromium ANGLE Metal.

## Findings and experiment

The frontend CPU profiles spend most of refresh waiting for the backend.
A separate phase probe isolated `render_geometries`: even a point-only workspace
was ordering/scanning the matching Events and running a shape window query to
produce an empty packet. Warm calls took about 233 ms out of a 285 ms coherent
backend snapshot.

The candidate checks the existing partial `events_geometry` index first. When
there are no stored WKT geometries it returns the same empty packet immediately,
including revision, requested offset, bounds and semantics. The index is read on
every request, so geometry edits and Undo/Redo cannot leave stale cached absence.
Mixed geometry workspaces retain their existing rendering path. No index/schema,
render budget, data precision or source-record changes were made.

| Measurement | Baseline | Experiment |
| --- | ---: | ---: |
| UI refresh median, round 1 | 309.9 ms | 70.2 ms |
| UI refresh median, round 2 | 311.1 ms | 66.3 ms |
| Filter + refresh median, round 1 | 950.5 ms | 898.8 ms |
| Filter + refresh median, round 2 | 934.9 ms | 867.7 ms |
| Warm backend coherent snapshot | 285.1–285.3 ms | 52.6–52.7 ms |
| Warm empty shape request | 232.6–233.5 ms | 0.17–0.18 ms |
| Navigation, focus and playback cadence | about 60 fps | about 60 fps |

UI repeated refresh is **4.55× faster (78% less waiting)** using the median of
the two per-round medians. Filtering still takes around 0.9 seconds and is the
next interactive bottleneck; its smaller observed improvement is not a
statistical claim. Drawing was already smooth in this configuration.

Two separate backend storage runs used a richer million-row fixture with an
80-character label and original attributes, producing a 2.40 GB portable file.
They measured import at 31.9–32.1 s, save at 18.7–20.1 s, reopen at 17.2–17.4 s,
and full statistics snapshots at 2.65–2.67 s. Those costs remain. The simpler
interactive CSV imported in 22.5 s in both variants. The storage benchmark's
36.8–40.1 s `copy_into` measurement is a diagnostic helper, not a currently called
production path, and was not chosen as an optimization target.

## Evidence and limits

[results.json](results.json) contains binary hashes, baseline storage measurements,
backend phase samples, both UI rounds, frame summaries, exact-query results and
limitations. Large inputs, browser CPU profiles, screenshots, full reports and
the portable fixture remain ignored under `.qa/million-event-performance/`.

These are local Chromium/Metal frontend measurements and optimized shared Rust
backend measurements, not native WKWebView/GPU presentation certification.
Two rounds per browser variant, an uncontrolled OS page cache, a synthetic
workload and sequential A/B order do not establish general tail latency or
performance for every dataset. Peak owned process-tree RSS stayed below the
5 GiB guard: roughly 2.8 GiB baseline and 3.5 GiB candidate; retained JS heaps
were approximately 42 MiB each. No memory improvement is claimed.

## Correctness checks

119 Rust tests passed across the library, new geometry-presence regressions,
WKT/WMTS, display snapshots, native snapshot publication, render budgets,
SQL indexing, performance regressions and hardening. New tests check the empty
packet's offset/fields, geometry insertion, Undo/Redo, and partial-index access.
Both million-event browser variants passed exact-count, bounded-marker and
cell-membership checks with zero renderer/page errors or public map requests.
The reusable backend probe also ran successfully against the million-event input.

## Local reproduction

Use the configured `.local-build/env.sh` under Bash and preserve distinct
baseline/candidate binaries before changing source. Build with
`python3 scripts/guarded_run.py -- cargo build --release --locked --bin chronoscope`.

For each binary run the parameterized existing UI benchmark with:

```sh
CHRONOSCOPE_PERF_ROWS=1000000 \
CHRONOSCOPE_PERF_ROUNDS=2 \
CHRONOSCOPE_PERF_BUDGETS=20000 \
CHRONOSCOPE_PERF_CPU_PROFILE=1 \
CHRONOSCOPE_QA_RUST_PROFILE=release \
CHRONOSCOPE_CLI=/absolute/path/to/variant \
CHRONOSCOPE_PERF_OUT=/absolute/path/to/new/output \
python3 scripts/guarded_run.py -- node frontend/scripts/performance-100k-qa.mjs
```

The original 100,000-event defaults remain available. Use
`CHRONOSCOPE_PERF_PROJECT=/absolute/path/to/million.chronoscope` to save a portable
input during a run. Backend phase timings can then be reproduced with:

```sh
python3 scripts/guarded_run.py -- python3 scripts/benchmark_refresh.py \
  --binary /absolute/path/to/variant \
  --project /absolute/path/to/million.chronoscope \
  --expected-count 1000000 --output /absolute/path/to/probe.json
```

The original recorded phase probe used six wider stepped time windows than this
reusable driver. The existing storage benchmark is `performance_storage`; run its
release executable with `1000000 /absolute/path/to/fixture-directory` under the
resource guard. Its full mode checks portable save/reopen, indexed queries,
field values and bounded rendering; it removes disposable database copies.
