# Final Intel repair: Mac cross-check — 25 October 2026

> Follow-up: [final chat-session and recovery verification](../linux-followup-mac-2026-10-25/README.md) records the later repairs and their Mac evidence. This report preserves the earlier promotion checkpoint.

Product source `3e6f789` passed the five focused browser suites: playback transitions, live MCP, workspace boundaries, guided workflows and the full five-demo matrix including saved bloom restoration. All 48 frontend cases, 11 runner cases, 103 packaging cases, four numerical/protocol suites, formatting, strict core lint, CLI/frontend builds and generated contracts passed.

Playback measured **68 updates in 3.5 seconds / 50.2 ms median** on Apple M5 / Chrome Metal. The existing 20-update minimum and 180 ms upper median limit were unchanged. Bloom retained at most two layers, pause settled to one atlas and full-range playback/pause issued no redundant filter writes. No renderer errors were reported.

A separate native run passed strict native lint, compilation, desktop CLI smoke, the maintained bundle/launch command, all 13 terrain/navigation checks and all five real native MCP checks. Terrain checks cover globe/map/space-time, pan/zoom, Antarctica, Greenland, portable save/open, custom DTED and resource policy. Native Tauri dispatch remains independent of the browser transport.

Runs were serial under `scripts/guarded_run.py`, with one Cargo worker. The native invocation peaked at 1,701 MiB owned RSS / 225% CPU. No hosted workflows ran. [Structured evidence](report.json) retains source/build hashes, commands and local artifact paths. These are focused Mac results; the separate Linux report records its full sweep. No new Windows or downloaded-binary certification is claimed.

## Promotion checkpoint

Fresh Mac checks of the three Linux failure owners passed: assistant, context-loss recovery, and the complete Cesium parity suite, including exact ±89° polar positions and real GPU picking. Parity used a visible Chrome/Metal window after the headless run closed Chrome during the polar-view switch. Both results are retained in the JSON; no assertion or quality limit was relaxed. The Mac check is a focused cross-check, not a new 49-suite Mac sweep.

The frozen Linux sweep completed all 408 Rust cases (zero ignored), 46 of 49 browser suites, the scale benchmark, both hardware benchmarks and native lint/build/CLI checks. It remains failed overall on assistant synchronization, context-loss status and polar Map parity. The user explicitly authorized source promotion with these Linux browser failures documented once the corresponding Mac checks passed. Clawcomp continues the repairs. This authorization supersedes the earlier requirement to resolve every Linux browser failure before promotion. Radeon recovery remains excluded.
