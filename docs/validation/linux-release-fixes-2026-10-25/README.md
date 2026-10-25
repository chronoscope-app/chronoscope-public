# Linux failure fixes and hardware limits — 25 October 2026

> Follow-up: the Intel pacing failure recorded below was repaired in product commit `3e6f789`. The official focused Intel run passes with 29 updates / 124.7 ms median against unchanged limits; the final Mac cross-check also passes. See [the Intel investigation](../intel-playback-latency-2026-10-25/README.md) and [Mac verification](../intel-playback-mac-2026-10-25/README.md). This report preserves the earlier failed checkpoint; read the newer report for full-sweep status. The user accepts Intel as the Linux hardware gate and explicitly excluded Radeon recovery.

Tested source: `08871720a0a4000762d63970efeb467735af4a8f`. Application changes remain at `163ae43`; later changes label CLI profiles and correct test fixtures/policy. [Structured evidence](report.json).

The final Intel/Vulkan **release CLI** run passed terrain, full five-demo loading/mode/table/playback matrix and saved bloom, view sync, live MCP, 42 frontend tests, 11 runner tests, 103 packaging tests, four numerical/protocol suites, core/native Clippy, native compilation and real desktop CLI/MCP smoke. It remains **failed overall**: playback installed 16 updates in 3.5 seconds, below the unchanged minimum of 20. A visible-window comparison installed 17 and also failed. No threshold was lowered.

The fixes use exact ellipsoid footprint intersections; observable requested-mode frames and data readiness; final pause/filter/effect settlement; and a checksum-pinned Cesium picking-tree patch. The five deterministic picker regressions cover stale completions, refused tasks, asynchronous rejection, synchronous worker construction failure, and pinned/idempotent application. Heights, triangle indices, terrain budgets and coverage assertions remain intact. The original Map centre query returned no height from a valid mesh; the corrected query returns 5440.363557699982 m.

Demo polling was independently proved faulty: timer samples saw 8,473 Events and idle at 16.9 seconds, while RAF samples stopped before readiness; the original 30-second poll timed out. After that repair, the full software matrix still timed out on a real Map-button stability wait. Debug hardware runs also exceeded a demo-load deadline (`demo_open` took 28.2 seconds); the optimized CLI passes the complete matrix. Those failures remain recorded.

| Configuration | Outcome |
| --- | --- |
| Original SwiftShader | Terrain/pacing failures retained; no software performance clearance |
| Earlier Radeon checkpoint | 60 updates, 55 ms median; all four playback assertions passed; predates final source |
| Final Intel release, headless | Four app suites pass; pacing 16/20 fails |
| Final Intel release, visible window | Pacing 17/20 fails |
| Intel small hardware benchmark | passed; 27 samples |
| Intel 100k hardware benchmark | passed; 36 samples at report update |

Both already-running optimized Intel benchmarks have now completed. The 100k workload retained 100,000 source/visible/aggregate counts at both the 20,000- and 100,000-marker budgets, with zero reported renderer errors and zero public requests. Benchmark completion does not clear the separate pacing gate. The JSON retains callback-cadence medians, exact environment/commands and renderer/window receipts; these are shared-workstation measurements, not controlled speedup estimates.

Actual Intel renderer: `ANGLE (Intel, Vulkan 1.4.335 (Intel(R) UHD Graphics (CML GT2) (0x00009BCA)), Intel open-source Mesa driver)`. Selection used `VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json`, native Vulkan and explicit hardware checks. Runtime receipts retain headless mode. Reports distinguish optimized CLI from the separately verified debug native binary.

The Radeon render node now returns `EINVAL` and runtime status is `error`. The interrupted run is not final-source Radeon certification. The owner chose to leave the machine running; no reboot, reset or rebind was attempted. Earlier successful Radeon measurements remain separate from this limitation.

Exact commands, source/binary/patch hashes, original/final terrain scene values, run IDs, raw local evidence paths and benchmark status are in the JSON report. Raw profiles, tokens, screenshots and databases stay under ignored `.qa/`. The original full Rust log totals **408 passing cases, zero ignored** when summed from per-binary summaries; the earlier chat's per-line count of 407 missed one case. Rust sources are unchanged and that full gate was not repeated in this focused stage.

This is a five-suite corrective check, not a fresh 49-suite release acceptance pass. Benchmark completion does not clear the separate pacing gate. No Public promotion or hosted workflow was performed.
