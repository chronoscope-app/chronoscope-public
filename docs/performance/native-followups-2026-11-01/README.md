# Native million-event follow-up experiments

These local experiments start from performance commit `35ce870`. They are
performed in order: native validation, overview-delay profiling, portable
save/reopen. No hosted runners or Public promotion are used.

## Native comparison method

Baseline is the preserved installed optimized app from Next commit `ef5efe5`;
candidate is an optimized `script/build_and_run.sh --build-only` bundle from
`35ce870`. The build script installs the candidate in `~/Applications` as required
by repository instructions. Frozen comparison bundles and their binary hashes
are retained under ignored `.qa/native-million-2026-11-01/`.

Both variants run with private profiles and coherent SQLite backups of the same
one-million-point input, copied inside each private MCP file root. The original
input and normal workspace are not changed. Preferences disable network map
layers, terrain and autosave, and select the same dark theme. The scene uses
20,000 representative points, bloom, tracks and trails, a fixed camera, and the
same native viewport.

`scripts/native_million_qa.py` measures six distinct quarter-width filter windows,
repeated adjacent windows, camera movements, zoom, and overview readiness after
navigation through the app's attached public MCP interface. A native window
capture verifies that the million-event scene is rendered. Each variant then
runs an uninterrupted ten-minute filter/zoom memory soak. Private profiles are
retained until both runs finish, and only the launched app PID is terminated.

Timings include command transport and a 100 ms readiness stability requirement.
The opt-in frame trace records callback intervals and CPU submission, not GPU
completion or physical presentation. Long gaps must be correlated with input
and idle periods. Sampled RSS covers the isolated app and newly observed WebKit
processes; unrelated newly launched WebKit clients would confound attribution.
One sequential run per variant and uncontrolled OS page cache do not establish
general tail latency or leak freedom.

```sh
python3 scripts/guarded_run.py -- python3 scripts/native_million_qa.py \
  --app /absolute/path/to/variant.app \
  --dataset /absolute/path/to/million.chronoscope \
  --output /absolute/path/to/unused/output \
  --source-commit COMMIT --soak-seconds 600
python3 scripts/compare_native_million.py --directory .qa/native-million-2026-11-01
```

The Mac must stay unlocked. Read-only readiness checks may be retried after an
initial timeout; mutations are never replayed automatically. Setup scope failures
and an invalidated early harness run are excluded from the final comparison.
The current comparison uses only the complete restarted baseline/candidate runs.

## Experiment 1: native result

| Native command-to-ready median | Preserved app | Performance candidate |
| --- | ---: | ---: |
| Six distinct filter windows | 1,303 ms | 1,090 ms |
| Repeated adjacent windows | 734 ms | 541 ms |
| Camera movement/data readiness | 4,791 ms | 1,451 ms |
| Zoom/data readiness | 4,587 ms | 1,535 ms |
| Overview after navigation | 3,440 ms | 3,177 ms |

Both completed uninterrupted 600-second soaks. Median RSS in the first/last soak
minute was 1,378/1,292 MiB for the baseline and 1,315/1,288 MiB for the candidate.
Sampled peaks including setup were 1,928 and 1,945 MiB respectively. No rendering
errors or context recoveries were reported, and neither trace was truncated.
Both used Apple GPU / WebGL 2.0, a 1479×1338 framebuffer and scale 1.5. Native
captures are retained locally. [native-results.json](native-results.json)
contains the full paired summaries, binary hashes and limitations.

The result supports a real native data-readiness improvement. It does not show a
reduction in sampled peak memory. Request-render callback p95 intervals include
idle/backend-wait periods (1,223/970 ms here) and cannot be read as gesture FPS or
physical presentation stalls. The soak repeats activity after 25-second pauses,
so faster variants can complete slightly more activity cycles in ten minutes.

## Experiment 2: remaining overview delay

An opt-in SQLite profile found that the located-point and missing-location
orderings formatted coordinates as text simply to test emptiness. For valid
native numeric fields, an empty value is exactly SQL NULL. The candidate uses
`IS NULL`/`IS NOT NULL` for empty predicates on latitude, longitude and value;
nonempty comparisons, attribute text and signed-zero formatting keep their
existing behavior.

| Diagnostic DataStore phase, median | Before | After |
| --- | ---: | ---: |
| Summary | 144.6 ms | 145.6 ms |
| Display aggregation | 200.0 ms | 202.8 ms |
| Located ordering + sample | 134.3 ms | 112.9 ms |
| Missing-location inference preparation | 85.2 ms | 51.9 ms |

Two matched native passes gave filter-to-ready round medians of
1,089.7/1,095.5 ms before and 1,037.0/1,045.5 ms after. The combined median is
**1,092.6 → 1,041.3 ms (4.7% less time)**. This is a small improvement supported
by a roughly 54 ms saving in the isolated ordering work. The diagnostic phases
omit Engine packet encoding, transport, rendering and readiness, and should not
be treated as an exact additive native budget. Display aggregation, summaries
and UI work remain material costs. No pan/zoom or memory improvement is claimed
for this change.

All 23 compared summaries and 89 packet sections match exactly. The selected
full regression set passed 191 tests, including the new original-predicate
comparison; a separate logging concurrency test brings the distinct total to
192. Profiling exposed an existing issue where concurrent diagnostic writers
could interleave JSON fragments. Logging now formats one complete line before
appending, verified with 16 writers/800 records. Native timings above measure the
numeric-predicate change; no performance benefit is attributed to the logging
repair. [overview-results.json](overview-results.json) records the paired native
runs, exact comparisons and hashes.

The reusable profiler is opt-in and absent from normal app tracing:

```sh
cargo build --release --locked --features performance-sql-trace --example profile_overview
python3 scripts/guarded_run.py -- target/release/examples/profile_overview \
  /absolute/path/to/million.chronoscope /absolute/path/to/profile.json
```

It records millisecond-granularity SQLite profile durations (including cursor
processing) and separate read-phase wall times. The normal app does not enable
`performance-sql-trace`. Two native passes and an uncontrolled OS cache do not
establish general tail latency. Native short passes do not repeat the completed
experiment-1 ten-minute soak.

## Experiment 3: portable save and full reopen

The original save path backed up the working database, scrubbed portable-only
content, then ran in-place `VACUUM`. SQLite compacts in-place databases through
a temporary database and copies the result back. The candidate uses
`VACUUM INTO` to write a second private staging file directly, avoiding that
copy-back. Both staging files are cleaned automatically. The existing file sync,
cancellation boundary, atomic replacement and parent-directory sync still
publish the finished file. A non-UTF-8 parent path retains the original path.
See [SQLite's VACUUM documentation](https://www.sqlite.org/lang_vacuum.html).

Undo history, recovery metadata, deleted payload remnants and transient
resources are still excluded from portable files; the working database keeps
its undo history. Full reopen validation is unchanged, including canonical
event fields, attributes, search and spatial indexes, and bundled resources.

`scripts/benchmark_project_io.py` runs prebuilt baseline/candidate binaries in
ABBA order against an immutable million-event portable fixture. Each run owns
a disposable profile. Timings cover public CLI Engine save/open calls, without
native UI. Outside the timed operations, every saved event's row identity, ID
and serialized payload is hashed and compared with the source. Each reopened
project must contain one million events and return the same projected sample.
OS page-cache state is uncontrolled, and two runs per variant do not establish
tail latency.

| Public CLI operation, median | Before | After |
| --- | ---: | ---: |
| Portable save | 7,107.8 ms | 4,417.9 ms |
| Full reopen | 11,665.1 ms | 11,697.6 ms |

Save takes **37.8% less time** across the two runs per variant. Reopen is
effectively unchanged (+0.3%); no reopen improvement is claimed. Every saved
file is 1,546,977,280 bytes and all million-row payload hashes match. The input
is 1,565,696,000 bytes. This is the native-test fixture, not the earlier richer
2.4 GB fixture that took approximately 19–20 seconds to save. Initial opens
varied from 12.2 to 19.2 seconds, so this experiment does not establish a
startup improvement. [storage-results.json](storage-results.json) retains each
run, executable hashes and comparison limits.

The targeted regression set passed 101 distinct checks, including cancellation
before backup and immediately before publication, temporary-file cleanup,
portable resources, deleted-payload scrubbing, working Undo, signed zero and
derived-index tampering. The non-UTF-8 path test is Linux-only because APFS
rejects such directory names; it was not run on this Mac. Formatting was checked
on changed Rust files and the Python driver passed syntax compilation.
