# Local test workflow

Tests and their feature ownership live in `scripts/validation-suites.json`.
`scripts/validate_local.py` is the entry point for fast, focused and full runs.
It never starts GitHub Actions. All commands below run from the repository root,
with Rust, Node/npm, Python and frontend dependencies available.

| Need | Command |
| --- | --- |
| Core/unit checks | `python3 scripts/validate_local.py` |
| Core/unit checks plus a short browser smoke journey | `python3 scripts/validate_local.py --browser` |
| Map/terrain changes and their Rust targets | `python3 scripts/validate_local.py --feature maps` |
| One browser regression using verified existing builds | `python3 scripts/validate_local.py --suite navigation --skip-build` |
| Full local release checks, including all datasets and numerical oracles | `python3 scripts/validate_local.py --tier full` |
| Full checks with the optimized production CLI | `python3 scripts/validate_local.py --tier full --release-cli` |
| Full checks plus actual isolated Mac GUI terrain verification | `python3 scripts/validate_local.py --tier full --native-gui` |
| Native MP4 pan/zoom capture and per-frame analysis | `python3 scripts/validate_local.py --suite balanced-terrain --native-video` |
| Explicit resource-intensive benchmarks | `python3 scripts/validate_local.py --performance` |
| Inventory or planned selection, without running tests | `python3 scripts/validate_local.py --list --feature charts` |

`--suite`, `--feature` and `--rust-test` can be repeated. Explicit selections run
the requested suites rather than silently expanding to every browser test.
Without an explicit selection, `--tier full` runs every registered browser suite.
`--browser` on the fast tier runs just the small integration journey and Welcome.
The default Rust run retains correctness, resource-bound, data-integrity and
security regressions, including the tests named `performance_*`.

The full demo round-trip matrix is an explicitly ignored Rust test in routine
Cargo runs. The full tier uses `--include-ignored`, and also enables the browser
demo/Time-title matrices through `CHRONOSCOPE_QA_FULL=1`. A small representative
round-trip remains in routine checks. Direct `cargo test` therefore reports this
one matrix as ignored; that is intentional, not release acceptance.

## Prerequisites and resource use

On this 16 GB Mac, wrap heavy runs with
`python3 scripts/guarded_run.py -- python3 scripts/validate_local.py ...`.
It uses low priority, one Cargo worker and serial Rust tests. It refuses to start
below 35% reported memory availability and stops only its owned process group
if availability falls below 25%, its tree exceeds 5 GiB RSS, or tree CPU stays
above 250% for 15 seconds. Browser jobs remain one by default. Run one guarded
build/test at a time; the guard is not a global scheduler or a GPU-memory meter.
It reports peak owned usage and propagates failure rather than silently retrying.

Set `CHRONOSCOPE_CHROMIUM` or pass `--chromium` for a nonstandard browser path.
The shared browser runtime chooses Metal on macOS and SwiftShader elsewhere;
`CHRONOSCOPE_QA_ANGLE` explicitly overrides that choice. Keep correctness results
separate from hardware performance claims.

The two hardware benchmarks use a native backend automatically: Vulkan on Linux,
Metal on macOS and D3D11 on Windows. Their renderer checks still reject software
fallback. The million-row scale proof keeps the normal correctness backend.
On macOS, hardware benchmarks use a visible Chrome window: repeated headless
Metal runs closed Chrome mid-measurement on this Mac, while the same workload
completed with a window. Ordinary correctness checks remain headless. Set
`CHRONOSCOPE_QA_HEADLESS=1` to explicitly request headless mode or `0` to request a
window; receipts record this choice alongside the backend. A closed browser is a
failed/incomplete benchmark, even when its earlier frame samples look healthy.
`CHRONOSCOPE_QA_HARDWARE=1` also selects the native backend for a focused browser
run, for example the unchanged playback throughput assertions:

```sh
CHRONOSCOPE_QA_HARDWARE=1 python3 scripts/validate_local.py --suite playback-transitions --skip-build
```

`CHRONOSCOPE_QA_ANGLE` takes precedence even for a hardware run; selecting
SwiftShader deliberately will therefore fail a hardware-only benchmark. Runtime
receipts record the selected backend, and benchmark reports retain the actual
WebGL renderer. A backend name alone is not evidence of hardware acceleration.

For a full Linux release check on a verified hardware GPU and installed Chrome:

```sh
CARGO_BUILD_JOBS=2 RUST_TEST_THREADS=1 CHRONOSCOPE_QA_HARDWARE=1 python3 scripts/validate_local.py --tier full --release-cli --native --performance --browser-jobs 1 --chromium /usr/bin/google-chrome
```

Load the local SDK and Python oracle environment first as needed. Keep the
renderer receipt with the report. SwiftShader remains the default for ordinary
Linux correctness checks, but the dense Antarctic readiness deadline and live
playback throughput gate can fail on this CPU renderer. A hardware pass does not
clear those retained software failures or establish software performance.

The default CLI build is debug. Use `--release-cli` for production-profile
acceptance, especially real-data load deadlines and hardware benchmarks. Reports
and build receipts label the selected CLI profile and hash its binary; reuse
rejects a different profile even when binary bytes happen to match. Native
compile/CLI/GUI checks retain their separately reported debug build. Preserve
debug-profile timeouts when an optimized run passes; they remain debug results.

Build preparation applies the reviewed terrain-picker lifecycle patch in
`frontend/scripts/patches/terrain-picker.mjs` to Cesium 1.146.0 / engine 26.4.0.
It rejects unknown versions or source checksums, preserves upstream notices and
marks the modified source. Both `predev` and `prebuild` apply it; a fresh
application clears Vite's generated dependency cache once. Build fingerprints
include the patch directory. Remove the patch only after the upstream dependency
handles refused/rejected partition tasks and stale completions after reset, and
the deterministic regressions plus multi-mode terrain checks pass unchanged.

Use `--feature mcp-live` for the new playback/scenario/MCP Apps browser coverage
and owning Rust targets. `--native-gui` also verifies attached public MCP playback,
recipe execution, subscriptions and UI negotiation; `--native-video` replays
saved pan/zoom recipes in all three views while checking MP4 frames and their
companion diagnostic traces. The Apps test runs the actual HTML in a sandboxed
iframe with the documented host handshake, tests linked row/mark selection, and
checks imported markup stays inert. Host-specific rendering still requires a
compatible external MCP client.

Independent numerical oracles require NumPy, SciPy and scikit-learn. Install them
in a local QA environment rather than the application's environment, for example:

```sh
python3 -m venv .local-build/qa-python
.local-build/qa-python/bin/python -m pip install numpy scipy scikit-learn
.local-build/qa-python/bin/python scripts/validate_local.py --tier full
```

The runner checks these prerequisites before starting a full run. Native GUI
verification currently automates macOS only. It builds and launches this checkout's
app using a separate QA profile, enables its local typed agent and tests real
terrain, native rendering, save/open and DTED replacement. It replaces the running
development copy. Native pan/zoom checks require the terrain provider and imagery
cache to survive movement in all three views. Keep personal work in a separate
installed app/profile.
`--native` alone performs native compilation/lint and headless CLI/MCP checks.

Cargo's checked-in development/test profiles omit debug symbols and incremental
artifacts, and compilation defaults to one worker. The Run script and validation
use those same settings, avoiding alternating caches. Override `cargo -j N` or
`CARGO_BUILD_JOBS` when appropriate; use `CARGO_PROFILE_DEV_DEBUG=2` consistently
when source-level debugging is needed. Release profiles remain unchanged.

## Evidence and timeouts

Each invocation has a fresh run ID and evidence directory under
`.qa/local-validation/runs/`. A custom `--report` changes the summary location;
its sibling `runs/` still holds separate evidence for every invocation.
Browser launch receipts record the run, source revision, effective profile,
Chrome version and ANGLE choice. Reports use subprocess outcomes and matching
receipts from the current run, never copies of old `.qa/<suite>/report.json` files.

`--skip-build` checks a source fingerprint and hashes of the CLI and entire built
frontend. Missing or mismatched receipts fail before browser execution. A test
change alone can reuse app artifacts; a product/build-input change cannot.

Browser/Python suites have a 420-second outer timeout by default (`--timeout`).
Expiry stops the entire process group, including its browser/server children, and
records a failed check. Build/core steps have longer bounded limits. Suites run
sequentially unless `--browser-jobs` is explicitly raised; timing-sensitive
navigation/playback suites always run alone.

## Coverage ownership and consolidation

Each browser suite has exactly one feature owner in the manifest:

| Owner | Distinct responsibilities retained |
| --- | --- |
| Charts | Chart computation/rendering, new chart kinds, labels/persistence, timezone and field-role behavior |
| Navigation | Mouse/keyboard selection, compass/rail controls, rotated panning, held-drag queries, expanded Time ground and view sync |
| Time | Playback speed and transitions, sidebar bounds, time rail and subsecond precision |
| Rendering | Cesium primitives, effect pixels, context recovery, Globe time, clusters and entity coloring |
| Maps | Basemap/provider behavior, real bundled terrain, custom DTED, WKT/WMTS and map failure notifications |
| Workspace | Small integration smoke, empty state, tables, recovery, demos, document boundaries and presentation |
| GIS | Reference formats, native feature identity, vector conversion and portability |
| Assistant | Connected chat, focused AI, patterns, guided analyses and disabled experimental bridge |

The integration smoke owns one small golden path, not every feature's edge cases.
The broad renderer suite no longer repeats the rejected-row acceptance subset:
the guided-workflow suite owns that behavior, including rejection beyond the
preview, report export and preservation until explicit acceptance. Its distinct
Excel, MGRS/date-order, native/legacy Open routing and polar regressions remain.
Chart round-trip mechanics and complete configuration/preset comparisons are
shared; callers keep their distinct chart-kind, title, units, brush and exact-ID
assertions. Navigation direction, delayed selection restoration, viewport loading
and view sync remain separate because they catch different regressions.
Pixel-oracle cases use fresh browser resources per mode: repeated framebuffer
readbacks across all three modes closed headless Chrome/Metal on the validation
Mac. Integration smoke and renderer parity retain continuous mode transitions.

Idle-render checks assert a frame bound rather than merely logging it. Demo
playback checks require actual time-focus movement as well as no rendering errors.
The bundled-terrain suite samples every rendered frame during keyboard, mouse
drag and wheel navigation; it rejects terrain-provider resets and empty ground
frames rather than checking only the settled scene.
Other timing waits remain where elapsed time is the behavior under test, such as
hover delay and playback cadence; ordinary readiness waits use observable state.

Python packaging, numerical/protocol oracle and native checks are also inventoried.
On-device model quality, native certificate/keychain tests and Linux Xvfb captures
remain explicit manual/opt-in checks, with prerequisites recorded in the manifest.
They are not silently counted as passing by a normal local gate.

## Native video checks

`--native-video` includes the normal native GUI checks, then uses
`chronoscope_view_recording` to record pan/zoom sequences in Map, Globe and Time.
Install `av` (PyAV), NumPy and Pillow in the local QA Python environment first.
The runner decodes every recorded frame, saves timestamps/ground-region metrics,
and creates contact sheets plus neighboring images for suspicious frames.
An encoded negative control injects single black and white frames and must flag
both before real recordings are accepted. Recordings use Streets plus real
bundled terrain on the public wildlife demo. The analysis detects large blank
ground flashes and isolated frame discontinuities in its central region; inspect
clips/contact sheets as well for other artifacts. This is a correctness check,
not a GPU-performance certification. MP4s and raw frame evidence stay under .qa/.
