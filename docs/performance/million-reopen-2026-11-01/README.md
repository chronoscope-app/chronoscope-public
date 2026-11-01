# Million-event full-reopen experiment

Baseline is Next performance commit `05fdaae`. Both measured binaries are normal
optimized CLI builds, without profiling enabled. The fixture is the same
1,565,696,000-byte million-event workspace used in native testing, containing
100 tracks. No hosted runner, Public promotion or production workspace is used.

## Where the time goes

An opt-in `performance-open-profile` feature and `profile_open` example split
DataStore reopening into coarse phases. The profiler runs three sequential
opens into disposable directories. It logs only phase names and durations.
The verification parent phase includes the row and FTS child phases; these
must not be added a second time. Normal release builds compile the profiling
helper to no work.

The baseline first open took 18.74 seconds, with 11.51 seconds in `quick_check`.
The next two totals were 11.62 and 11.68 seconds, illustrating why this is not
a controlled cold-start measurement. Integrity checks remain in place.

| Diagnostic phase, median of three | Baseline | Candidate |
| --- | ---: | ---: |
| SQLite `quick_check` | 4,428.0 ms | 4,853.3 ms |
| Prepare and backup | 1,236.1 ms | 1,313.8 ms |
| Event and derived-row validation | 2,902.3 ms | 2,526.4 ms |
| FTS integrity check | 3,079.2 ms | 3,277.4 ms |

The targeted row phase takes **13.0% less time**. The later standalone candidate
profiles had slower integrity/copy phases, however: their total median was
11.99 seconds versus 11.68 seconds before. These separate diagnostic runs do
not show an overall speedup. This timing drift is retained explicitly, and
motivated an additional interleaved confirmation block. Phase profiling and
the normal Engine comparison have different scopes and conditions; they are
not an exact additive budget for one measured Engine call.

## Candidate

The row validator borrows SQLite TEXT for each current row instead of allocating
owned copies of the payload and canonical/indexed strings. It reuses small
buffers for IDs, padded ID keys, tags and reconstructed search text. ASCII
search text is lowercased in place; Unicode retains the canonical contextual
lowercasing behavior. Borrowed strings never outlive their current SQLite row.

All event decoding, record budgets, canonical field comparisons, strict UTF-8
and SQLite type checks, attribute/search/spatial comparisons, index definitions,
metadata/resource validation and both integrity checks remain active. There is
no trusted-file shortcut, persistent validation cache or schema change.

## Matched comparison

`scripts/benchmark_project_io.py --open-only --blocks 2` runs ABBA twice,
serially under `scripts/guarded_run.py`. Each run owns a disposable CLI profile,
performs an initial open and projected query, then measures a second full open
of the same immutable input. Reopened count must be one million and the sample
must match. All initial opens are retained in the results but are not mixed
with the repeated-reopen statistic. The full input event-payload hash is checked
before and after the experiment, outside timed operations.

After the diagnostic timing drift described above, a third ABBA block confirmed
the direction of the result. All 12 normal-build runs are included below.

The comparison uses six runs per variant, not a tail-latency estimate. OS cache
state is uncontrolled, CPU activity can vary, and native UI readiness is not
measured by this CLI probe. Source data, native data, and portable resource
formats are unchanged.

| Full reopen | Baseline | Candidate |
| --- | ---: | ---: |
| Median | 12,060.7 ms | 11,630.2 ms |
| Observed range | 11,987.0–12,955.8 ms | 11,333.5–11,831.8 ms |
| Runs | 6 | 6 |

The combined median saving is **430.6 ms (3.6%)**. All three ABBA blocks favored
the candidate: 8.9%, 4.2% and 2.6% less time respectively. The initial eight-run
result was 5.7%; the additional block reduced the combined estimate. All 12 count/sample checks
passed and the input event-payload hash remained unchanged. Individual timings,
binary hashes and comparison limits are in [results.json](results.json).

The selected integration regression set passed 77 tests. A separate comparison
of reused search buffers against the canonical encoder brings the distinct
total to 78. The new round-trip test covers contextual Unicode case conversion,
embedded NUL, comma-containing/empty tags and `u64::MAX`, and rejects 13 forms
of altered text, wrong SQLite types or invalid UTF-8 without changing the input.
Existing tests cover geometry, fractional time, signed zero, removed payloads,
Undo, and modified derived indexes. Changed Rust files pass formatting checks;
the benchmark driver passes Python syntax compilation.

## Local reproduction

```sh
cargo build --release --locked --features performance-open-profile --example profile_open
python3 scripts/guarded_run.py -- target/release/examples/profile_open \
  /absolute/path/to/million.chronoscope /absolute/path/to/disposable-profiles

python3 scripts/guarded_run.py -- python3 scripts/benchmark_project_io.py \
  --baseline /absolute/path/to/baseline --candidate /absolute/path/to/candidate \
  --project /absolute/path/to/million.chronoscope --open-only --blocks 2 \
  --output /absolute/path/to/results.json
```
