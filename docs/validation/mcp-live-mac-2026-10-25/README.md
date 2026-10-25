# Live MCP additions: Mac validation, 2026-10-25

Implemented the requested additions: bounded performance traces alongside video,
saved navigation scenarios/readiness, actual timeline playback controls, live
resource subscriptions, and interactive query/chart results for MCP Apps clients.
Report-package export was excluded. [Contracts and limits](../../MCP-LIVE.md).

Profiles retain at most 6,000 per-render samples, with two active traces and eight
retained sessions. They measure CPU submission and loading/error counters, not
GPU time. Scenarios allow only typed view/playback operations and bounded waits,
persist at most 16 recipes, and support asynchronous status/cancellation. The
interactive resource uses exact query/chart data, revision/workspace selection
guards, inert imported text and no external network origins.

## Local verification

- 407 Rust tests passed; one intentionally ignored matrix remains excluded.
- 30 frontend tests passed, including bounded trace storage, timestamps, long-gap
  retention, concurrency, detached replies and listener cleanup.
- 8 validation-runner tests, core/native Clippy, Rust formatting, generated
  contracts, TypeScript/Vite, native signature/launch and bundled CLI smoke pass.
- Four focused browser suites passed: MCP live features, view sync, playback
  speed and playback transitions. The actual MCP Apps HTML was exercised in a
  sandboxed host harness: negotiation/lifecycle, sorting/search, row selection,
  bar-chart mark selection, refresh and inert imported markup. Playback also
  covers rapid UI pause/play without an older completion overwriting the label.
- Five attached public MCP checks passed on the Mac: Apps discovery/resource,
  subscriptions/unsubscribe, timeline controls, persistent recipe execution with
  telemetry, and asynchronous cancellation. Existing 13 native terrain checks
  passed, including all views, pan/zoom continuity, poles, portable save/open and
  custom terrain replacement.

## Recorded scenario replay

Each final native MP4 uses the public wildlife demo, Streets imagery and Balanced
terrain, replaying one saved 80-step recipe (24 pans, 16 zooms and timed waits).
The recorder's companion trace and the scenario's own trace are independently
bounded. Native output size/duration match the finished MP4. Native video metadata
continues to work after companion-trace history eviction.

| View | Decoded frames | Trace samples | Longest capture gap | Flash candidates |
| --- | ---: | ---: | ---: | ---: |
| Map | 318 | 258 | 33.3 ms | 0 |
| Globe | 329 | 289 | 31.7 ms | 0 |
| Space-time | 327 | 318 | 35.0 ms | 0 |

All **974** encoded frames were analyzed, with no rendering errors or terrain
provider replacements during movement. Contact sheets were inspected. Encoded
negative controls on medium and bright backgrounds detected their injected black
and white frames exactly. This detects broad blank ground/discontinuities, not
every small artifact or a flash between captured frames. The video timestamp now
uses ScreenCaptureKit's start delegate rather than request time; presentation
alignment remains approximate and is explicitly labeled.

Clips, per-frame metrics, camera/terrain traces and profiles remain locally under
`.qa/mcp-enhancements/videos/`; videos are not committed to Git.

## Resource limits and evidence

Heavy Mac work ran serially at low priority through `scripts/guarded_run.py`, with
one Cargo worker and one Rust test thread. Final frontend tests used one worker;
browser jobs were one. The guard refuses low-headroom starts and terminates its
owned process group on low memory availability, excessive RSS or sustained high
CPU. The final full Rust run peaked at 1,465 MiB owned RSS / 100% CPU; the final
native build at 1,731 MiB / 206%; the final browser run at 1,593 MiB / 81%.
These are process-tree measurements; global memory availability is checked too.

[report.json](report.json) records source/binary/video/profile hashes, exact
measurements, guard limits and run IDs. The focused runner receipt is
`.qa/mcp-enhancements/validation.json`. Final full-Rust, frontend, native CLI,
GUI and video logs are `.qa/mcp-enhancements-*.log` and
`.qa/mcp-live-browser-final.log`. No hosted runners were used.

Review found and corrected an interactive-chart field mismatch, a rapid
pause/play label race, expired companion-trace handling and recording-start
timestamp semantics. Their final relevant checks were repeated after repair.
An initial video invocation used Python without PyAV; it failed before capturing
and was repeated successfully with the existing QA virtual environment. Original
failed runs are not counted as passing. This is focused Mac validation, not a
full release sweep or a Windows native certification.

## Independent clawcomp baseline

[The connected device's final result](clawcomp-baseline.md) is preserved separately.
It built and ran the previously published Next main at `ed38f72`, using native
WebKit on the Radeon 550X. Its 18 standard stages passed, including 402 Rust and
29 frontend tests; 13 native terrain checks passed. Whole-app/map PNGs worked;
Linux video correctly returned `UNAVAILABLE`. In 320 sampled native rendered
frames across 48 pan/zoom actions, it found no blank-flash candidates, terrain
provider replacements, empty ground or readback errors.

That baseline is **not fully passing**: nine of twelve targeted browser suites
passed. Antarctic refinement/idle readiness, Map-source view sync (including a
polar footprint failure on diagnostic repeat), and SwiftShader playback
throughput failed. Original failures and bounded diagnostic repeats were retained;
no baseline fixes or tracked changes were made. The staged Linux debug executable
requires host GTK/WebKit and the documented DMA-BUF workaround; it was not an
AppImage/release-installer validation. These results do not certify the new MCP
features on Linux and are not counted as passing Mac checks.
