# Mac dataset loading and idle CPU — 2026-10-29

The [measurement data](mac-dataset-cpu-20261029.json) records the per-trial backend
timings, native process CPU totals, frame counts, source commits and app hashes.

The reported appearance mismatch was a saved **Light** preference. Restoring
**System** follows macOS dark mode. An isolated native app using System rendered
in dark mode, and the existing browser appearance journey passed live OS-theme
changes and explicit-theme overrides. Explicit Light/Dark choices retain their
meaning; the default remains System.

## Dataset loading

The installed 0.16.5 local app used a debug backend. Two fresh-profile trials per
configuration, with identical 0.16.5 backend code and bundled data, measured:

| Demo | Debug CPU seconds | Release CPU seconds | Debug elapsed seconds | Release elapsed seconds |
| --- | ---: | ---: | ---: | ---: |
| 128 Starlinks, 46,208 source records | 4.285 | 1.010 | 4.317 | 1.027 |
| 100 flights, 88,018 records | 5.975 | 1.215 | 6.001 | 1.233 |
| Hurricanes, 3,568 records | 0.440 | 0.110 | 0.442 | 0.110 |
| Falcon 9, 700 records | 0.180 | 0.050 | 0.179 | 0.050 |

Values are medians of two trials on this Mac. CPU seconds are accumulated
user+system time across backend threads, measured with `ps`; they exclude
WebKit, GPU and UI work. This is a 76% reduction in Starlink backend loading CPU
and an 80% reduction for flights, not an overall rendering/FPS claim.
Starlink's default 90-minute window still contains 11,648 matching positions.

`script/build_and_run.sh --build-only` now creates and installs an optimized
release app. `--debug-build-only` retains the former noninteractive debug mode;
interactive diagnostic modes also retain debug builds. Finish diagnostics with
an optimized build before handing the installed app back for daily use.

## Idle update passes

Native 0.16.5 WKWebView measurements on Starlink, hurricanes and Falcon 9 produced
zero rendered frames during each settled five-second interval. CPU was still
used: Cesium request-render mode avoids drawing, but continues its update loop.
The change limits update passes to 10 Hz after a quiet second. Input, explicit
render requests and camera changes restore full cadence immediately. Playback,
held interaction, morphing and pending terrain/imagery/effect work keep full
cadence. The limiter is disposed with the renderer and replaced during recovery.
No rendering budgets, dataset records, geometry or visual settings are reduced.

The installed 0.16.6 release copy passed the native idle/navigation/playback
checks. Each idle interval rendered zero frames; its update limit was 10 Hz.
Navigation and playback restored full cadence, and pausing returned to idle.
No render errors occurred. Measured native idle CPU was:

| Demo | 0.16.5 debug app | 0.16.6 optimized app + idle limiter |
| --- | ---: | ---: |
| Starlink | 14.04% | 10.90% |
| Hurricanes | 13.64% | 10.86% |
| Falcon 9 | 12.33% | 8.94% |

These percentages sum CPU time for the isolated GUI process and newly launched
WebKit helpers over one settled five-second sample per demo; 100% means one
fully used CPU core. Background work and measurement noise can change results.
The combined build/profile changes reduced observed idle CPU by 20–28%; these
samples do not isolate each change's contribution or measure GPU execution.
Loading can still briefly use a full core; the optimization shortens that work.

The exact installed 0.16.6 executable separately passed two fresh-profile backend
trials: Starlink took 1.020 CPU-seconds and flights 1.220 CPU-seconds in both
trials. Its executable SHA-256 is
`9fa8f2ba655b067f7e892cbef18b84883278c210485d3269171cd958e7556ef8`.
The locally signed optimized bundle was installed in `~/Applications`, with
only the latest Chronoscope app retained. No Public promotion or hosted runner
was used.

Validation also passed 154 frontend unit tests, appearance/navigation, both
SpaceX demos, playback speed and renderer recovery browser journeys, TypeScript,
core Clippy, generated contracts, version consistency and shell syntax checks.
The appearance journey's two obsolete `Off` assertions now expect `Ground`;
the shipped height control was unchanged.

Machine-local receipts are under `.qa/cpu-0.16.6-validation/` (the final appearance
rerun is `appearance-final-report.json`), `.qa/native-dataset-cpu/`, and
`.qa/cpu-0.16.6-installed-backend.json`. The earlier combined browser receipt
retains the failed obsolete-label assertion rather than overwriting that history.

## Reproduce locally

No hosted workflows are required. Close unrelated WebKit apps during native
measurement so the before/after process inventory stays attributable to the test.
The native harness launches and closes its own isolated-profile app instance;
it does not use the normal workspace. An unlocked display is required.

```sh
python3 scripts/guarded_run.py -- python3 scripts/profile_dataset_loading.py \
  --binary target/debug/chronoscope --label debug \
  --output .qa/dataset-loading/debug.json
python3 scripts/guarded_run.py -- python3 scripts/profile_dataset_loading.py \
  --binary target/release/chronoscope --label release \
  --output .qa/dataset-loading/release.json
./script/build_and_run.sh --build-only
python3 scripts/guarded_run.py -- python3 scripts/native_dataset_cpu_qa.py \
  --app "$HOME/Applications/Chronoscope.app" --label release \
  --expect-idle-limit
```

The small Starlink demo stays within the existing bundled size limit. The full
43-million-state stress source is unrelated to these results and remains local.
