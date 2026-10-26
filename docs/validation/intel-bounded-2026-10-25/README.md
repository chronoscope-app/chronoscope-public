# Bounded Linux Intel follow-up — 2026-10-25

The current playback gate passed twice with unchanged assertions: **31 updates / 118.2 ms median**, then **32 updates / 115.5 ms median**, in the existing 3.5-second workload. All three standard performance suites also passed their checks. The earlier slow-pacing failure did not reproduce, so **no software bottleneck was isolated and no product performance fix was made**. The bounded sequence stopped here; no profile/control or extra acceptance rerun was used.

Started from latest fetched Next main `006089358283c224dc24e57ae1ac5a2929097d66`. Tested revision `31b03616d659bc408bef192319934128c426e076` adds only test registration/shared-runtime corrections. Product source, playback assertions, renderer configuration and performance scripts match the starting main. The JSON report records the source digest, suite hashes, optimized CLI/frontend hashes, exact run IDs, runtime receipts and raw report copies.

- Linux kernel `7.0.0-38-generic`; Intel UHD Graphics CML GT2 (`0x9bca`, i915), ANGLE/Vulkan, Intel-only Vulkan ICD; Chrome 156.0.8078.47, headless.
- The independent demo QA initially consumed 6–8 CPU cores with SwiftShader. Per user instruction, it was allowed to finish. Before baseline, CPU busy was **0.83%**, with no SwiftShader processes; before repeat, **0.89%**. No competing SwiftShader or compiler process was detected throughout either playback run or the benchmark sequence.
- The release CLI was rebuilt with the normal optimized configuration, at most two Cargo jobs. No compilation overlapped browser timing. CLI SHA-256: `910865cf706fbbcab9faeb39765a63a156723546402fe1545b350e3476f2067c`.
- Acceptance limits remain at least 20 installs, median strictly below 180 ms, real bloom crossfade, at most two imagery layers, one layer after pause, zero render errors, and zero full-range filter writes. Fade remains enabled by default. All passed in both runs.
- Strict Clippy, formatting, GLib integrity, three playback Rust cases, 66 frontend unit cases, 11 runner cases, frontend build/contracts and all 11 navigation/preferences functional checks passed.
- The maintained runner initially refused discovery because the new unit/browser suites were missing from its inventory. They are now registered; the new browser suite also uses the shared launcher instead of hardcoded SwiftShader. These are test infrastructure changes.

## Concurrent upstream integration

Next main advanced during this run to `f611f1a096cb5877840aa1c2d93101856f2a5f10` with an independent, more complete inventory/shared-runtime correction. That upstream version was adopted. Its normal local runner check passed Clippy, formatting, integrity, frontend build/contracts, all 66 units, all 11 runner cases and all 11 navigation/preferences browser checks on Intel/Vulkan. A fresh optimized rebuild produced **byte-identical CLI and frontend artifacts** to those used in the timed runs. Product source, the shared launcher and all playback/performance scripts are also identical. The changed broad source digest reflects the test command in `frontend/package.json`.

Original timing receipts remain pinned to `31b0361`; no additional playback or performance run was added. The report includes the upstream run receipt and artifact identity proof. The independently tested local correction is superseded by the upstream fix.

## Performance interpretation

The million-row scale check, 36-sample 100,000-row benchmark, and 27-sample real-data/dense benchmark passed their existing assertions. Their full JSON evidence is embedded in [report.json](report.json). There were no public data requests or rendering errors in the performance suites.

The 100,000-row benchmark remains slower when all 100,000 points are drawn: focus/orbit/full-range playback measured approximately **12–14 FPS**, compared with **30–32 FPS** at the standard 20,000-point budget. Passing its data/resource assertions does not mean 60 FPS. These measurements do not separate application, browser/driver scheduling and GPU throughput well enough to name a causal software defect or a physical GPU fault. No quality or budget reduction was made.

The scale suite has legacy static `softwareRenderer: true`/SwiftShader text even though its shared-launcher receipt records Vulkan under the Intel-only ICD. Its raw report is retained as emitted; it does not independently query the WebGL renderer. Both playback runs and the other two performance suites explicitly report Intel/Vulkan.

## Scope and evidence

This is a bounded follow-up, **not a fresh complete release matrix**: the 50 browser suites, full Rust suite and native Linux GUI were not rerun. The prior failures in `../intel-playback-latency-2026-10-25/` remain historical evidence; current source and host differences prevent attributing the old failure to the CPU contention observed today. No Public promotion or GitHub-hosted runner was used. Radeon was not tested or reset.

Full durable report: `/home/claw/Documents/Codex/chronoscope-next/docs/validation/intel-bounded-2026-10-25/report.json`.

Raw local receipts, frames, screenshots, host samples and working profiles: `/home/claw/Documents/Codex/chronoscope-next/.qa/intel-bounded-2026-10-25/`.

- Baseline run: `20261025T231404Z-bcad4008`.
- Standard benchmark run: `20261025T231509Z-abf791ed`.
- Consistency repeat: `20261025T232257Z-52d3e35e`.
