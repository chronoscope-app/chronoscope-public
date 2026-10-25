# Next failure repairs — 25 October 2026

> Follow-up: the Intel pacing failure recorded below was repaired in product commit `3e6f789`. The official focused Intel run passes with 29 updates / 124.7 ms median against unchanged limits; the final Mac cross-check also passes. See [the Intel investigation](../intel-playback-latency-2026-10-25/README.md) and [Mac verification](../intel-playback-mac-2026-10-25/README.md). This report preserves the earlier failed checkpoint; read the newer report for full-sweep status. The user accepts Intel as the Linux hardware gate and explicitly excluded Radeon recovery.

Follow-up to the clawcomp chat **Test latest next main and promote** and its
full local check of `8bfe37b`. The original report remains at
`/home/claw/Documents/Codex/chronoscope-next/.qa/public-promotion-2026-10-25/report.json`.
It recorded five browser failures and two hardware benchmarks that rejected
SwiftShader. These original failures are not overwritten by this follow-up.

Work is developed and integrated in `chronoscope-app/chronoscope-next/main`.
No Public promotion or hosted workflow is part of this repair task. The pending
`codex/retire-apple-si-chat` branch was checked: its completed feature is already
integrated by squash commit `ee83f5c`.

**The application and harness repairs are integrated; Linux hardware acceptance
is not wholly passing.** The optimized Intel run passes the full demo matrix,
terrain, view sync, MCP, packaging, numerical checks and native compile/CLI smoke,
but playback records 16 updates headless / 17 with a window against the unchanged
minimum of 20 in 3.5 seconds. The Radeon is in a driver runtime error state.
The user explicitly chose to leave clawcomp running and document this limit;
no reboot, driver reset or device rebind was attempted. Earlier healthy Radeon
passes are checkpoint evidence, not a final Radeon certification.

## Scenario isolation and diagnostic evidence

`ee7f05f` fixes scenario guards after asynchronous status responses. Workspace
replacement, cancellation and deadlines are rechecked before publishing final
telemetry/completion. Readiness status retrieval also counts toward its deadline.
Six deferred-operation/mocked-clock unit regressions cover these cases and
preserve already-completed scenario results after later workspace changes.

The MCP browser regression now prepares the replacement dataset before starting
the active scenario, then refreshes the UI immediately. Previously, slow demo
loading could outlast its four-second scenario; a legitimately completed run
was then incorrectly expected to fail. Terminal status is polled explicitly.
The assertion still requires the precise workspace conflict, zero completed
steps and stable results for the earlier completed run.

Demo failures now retain up to 200 API command timings, bounded visible state and
a failure screenshot, without capturing auth tokens or dataset payloads.

## Mac verification

Runs use `scripts/guarded_run.py`, one Cargo worker, one Rust test thread and
serial browser jobs. Browser correctness runs use Chrome/Metal.

- Original full demo matrix: all five datasets passed loading, three geographic
  modes, numeric table sorting and playback; final saved AIS bloom restore passed.
- Rust formatting, strict core Clippy, GLib integrity, CLI/frontend build and
  generated contracts passed.
- All 36 frontend unit tests passed, including six new scenario regressions.
- Updated representative demo and final MCP browser checks passed.
- The broader default gate passed all 407 routine Rust cases (one full demo
  matrix intentionally ignored), contracts, all 36 frontend cases, integration
  smoke and Welcome: `.qa/next-bugfix-mac/core-smoke.json`, run
  `20261025T180324Z-6fc7dce3`; peak owned RSS 1,815 MiB / CPU 256%.
- Final MCP invocation: `.qa/next-bugfix-mac/mcp-final.json`, run
  `20261025T180239Z-e4c5cf7b`; peak owned RSS 1,718 MiB / CPU 211%.
- Earlier focused build/demo run: `.qa/next-bugfix-mac/focused.json`, run
  `20261025T175845Z-987062e0`; peak owned RSS 2,082 MiB / CPU 284%.
  Its MCP check failed on premature asynchronous harness polling; that harness
  error was corrected and the final MCP check above passed.
- Linux source checkpoint `b320968` also passed a fresh Mac build/lint/contracts,
  37 frontend unit tests and all five focused browser suites: Balanced terrain,
  demos, view sync, live MCP and playback transitions. Evidence:
  `.qa/next-bugfix-mac/combined-checkpoint.json`, run
  `20261025T181844Z-e70b4525`; peak owned RSS 2,122 MiB / CPU 260%.
- Final readiness harness commit `a424f41` passed the complete five-dataset demo
  matrix, saved bloom restoration, view sync, all 37 frontend cases, contracts,
  103 Python packaging checks and four numerical/protocol suites. Evidence:
  `.qa/next-bugfix-mac/final-readiness.json`, run
  `20261025T182219Z-97ac7aaa`; peak owned RSS 2,189 MiB / CPU 293%.
- Final application source `163ae43` passed all five focused browser suites,
  including the complete demo matrix, all 42 frontend cases, nine validation
  runner cases, core/native strict Clippy, contracts, CLI/native builds, local
  bundle signature/launch, 13 native terrain checks and five attached native
  MCP checks. Native Map/Antarctic captures were inspected. Evidence:
  `.qa/next-bugfix-mac/final-native.json`, run `20261025T184102Z-5a1b659a`;
  peak owned RSS 2,347 MiB / CPU 270%.
  That invocation retains its failed packaging fixture check. The new build hook
  required a fixture-local stub; macOS also required canonicalizing its `/var`
  alias. The exact corrected fixture at `f76c585` separately passed all 23 cases:
  `.qa/next-bugfix-mac/packaging-fixture-final.json`. Together with the original
  other 80 passing packaging checks, all 103 cases are verified. All four
  numerical/protocol suites passed. This combines explicitly identified runs;
  it is not a claim that the earlier invocation was wholly passing.
- The final profile-aware runner at `0887172` passed its normal debug build path,
  all 11 runner regressions, 42 frontend cases, contracts, strict core lint and
  the live MCP browser check: `.qa/next-bugfix-mac/final-runner-profile.json`, run
  `20261025T190656Z-17a535a4`; peak owned RSS 2,341 MiB / CPU 361% (transient).
  `--release-cli` selects an optimized browser/oracle CLI and separate profile
  receipts. Native checks explicitly retain their debug profile. A receipt
  cannot relabel a debug binary as release even if the bytes happen to match.

## Terrain, projection and readiness repairs

- Terrain-free Globe footprints use exact WGS84 intersections. The previous
  rendered triangle chords could produce corner heights kilometres below the
  ellipsoid, destabilizing high-latitude synchronization.
- A version/checksum-pinned Cesium patch isolates an old partition worker from a
  rebuilt picking tree, retains valid parent triangles when scheduling is refused,
  and contains both rejected promises and synchronous worker-construction errors.
  Five deterministic tests include upstream negative controls and retry behavior.
  Normal preparation applies the patch idempotently, invalidates old development
  dependency caches and refuses unreviewed dependency changes. Patch sources are
  included in build fingerprints. Installed patched source SHA-256:
  `198f7ed298ee6e97f6e1a625f12f8b8391079c859a0f929c63d20bcaf7385568`.
- Demo data/DOM readiness uses timer polling; rendering assertions still wait for
  a frame in the requested mode. The controlled Linux trace was ready at 16.9 s
  with 132 ready timer samples before its original 30 s deadline, while RAF
  callbacks stopped at 16.5 s. The timeout was therefore reproducibly false.
- View sync awaits a rendered frame in the requested Cesium mode before measuring
  footprint coverage. Pause cleanup awaits final filtering and effect installation
  before requiring exactly one atlas. Fixed 100/150 ms sleeps did not establish
  either condition. Coverage, throughput and layer-count assertions remain intact.

## Hardware benchmark results on Mac

Hardware-only benchmarks now select native backends instead of forcing Linux
software rendering. Their actual renderer checks still reject software fallback.
Mac hardware runs use a visible Chrome window by default; ordinary correctness
checks remain headless. `CHRONOSCOPE_QA_HEADLESS=0/1` explicitly overrides the
window choice, which is recorded in runtime receipts. The launcher policy and
all 42 frontend cases passed after this QA-only change (`3097721`).

| Invocation | Outcome | Samples retained |
| --- | --- | ---: |
| Original headless Metal benchmark | Browser closed; incomplete | 16 |
| Original headless Metal 100k benchmark | Browser closed; incomplete | 9 |
| Temporary visible-window diagnostic | Complete pass; identical workload/assertions | 27 |
| Official visible-window benchmark | Complete pass | 27 |
| Official visible-window 100k benchmark | Complete pass | 36 |

Both final official runs report **Apple M5 / ANGLE Metal**, Chrome
`155.0.8059.85`, `headless=false`, no public requests or rendering errors. They
retain the existing 20,000/100,000 display budgets. The small run peaked at
1,816 MiB / CPU 117%; the 100k run at 3,265 MiB / CPU 165%. These measure Chromium,
not native WebKit FPS. Raw reports/logs remain under `.qa/next-bugfix-mac/hardware/`
and `.qa/next-bugfix-mac/hardware-*.log`; source/artifact hashes and individual
outcomes are preserved in [mac-results.json](mac-results.json).

[Structured Mac results](mac-results.json) retain each invocation, source revision,
outcome, log references and artifact hashes rather than combining failed checks
into a fictional passing run.

A Mac SwiftShader diagnostic loaded the first AIS demo and passed its mode
checks, then the resource guard terminated it for sustained CPU use (2,561 MiB
RSS, 623% CPU, 75% memory available). It is an aborted diagnostic, not a passing
software-rendering certification or an application assertion failure. Software
GPU outcomes are recorded separately on clawcomp. An initial sandboxed guard attempt
could not inspect processes; another inventory check overlapped creation of a
new test before its manifest entry. Both failed invocations remain in `.qa/`;
neither is counted as passing. A superseded native candidate invocation was
stopped before native builds after independent review identified the two worker
error paths above; its partial results are retained separately.

## Linux outcome and agreed hardware boundary

[The separate clawcomp report](../linux-release-fixes-2026-10-25/README.md) and
[structured Linux evidence](../linux-release-fixes-2026-10-25/report.json) retain
the exact commands, tested source, profiles, renderer selection and failures.
Its optimized Intel/Vulkan CLI passes the full five-demo matrix, terrain, view
sync and live MCP, 42 frontend cases, 11 runner cases, 103 packaging cases, four
numerical/protocol suites and native build/lint/CLI smoke. The original full Rust
gate totals 408 passing cases when its intentionally nonroutine matrix is included;
those Rust sources are unchanged. The independent Mac routine gate above passed
407 with that one matrix ignored.

Both optimized Intel hardware benchmarks completed successfully (27 small-suite
samples and 36 100k-suite samples). The 100k run preserved exact counts at both
display budgets, with no reported rendering errors or public requests. These
completed workloads remain separate from the pacing acceptance check below.

Linux's playback pacing gate remains **unmet** (16 headless / 17 visible-window
updates; minimum 20). The Radeon is in a driver error state and was not recovered,
as the user explicitly requested leaving clawcomp running. Earlier healthy Radeon
and later Intel results stay distinct. Debug demo-load timeouts and software-GPU
failures are retained, even where optimized hardware runs pass. Neither benchmark
completion nor the Mac passes clear the Linux pacing gate. This is a focused
repair verification, not a fresh passing 49-suite release certification.
