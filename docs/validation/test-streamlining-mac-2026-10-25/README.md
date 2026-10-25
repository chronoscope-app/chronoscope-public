# Test streamlining: Mac validation, 2026-10-25

Implemented the approved test-audit recommendations on Next main, based on
`38141cb20577104c10b4ca46ab2e8a175ea85ff8`. All verification ran locally.

The maintained entry point is [docs/TESTING.md](../../TESTING.md). It provides
fast, focused and full tiers, one feature owner per browser regression, shared
browser startup/cleanup and isolated profiles/evidence. Routine browser smoke
uses two small journeys; the full tier retains all 48 suites. The original full
demo matrices run only in the full tier, with a representative round-trip in
routine checks. Correctness/resource-bound Rust tests remain in the default gate.

The runner rejects stale builds, bounds suites and stops their process groups.
Its regression checks exercise real timeouts, child cleanup, failed commands,
selection, and stale source/binary/frontend-worker receipts. Idle and playback
checks now assert actual behavior. Chart round-trip mechanics are shared with
complete persisted-configuration/preset comparisons; import acceptance has one
owning suite while preserving populated-workspace rejection coverage.

## Results

- 402 Rust tests, including the complete bundled-data matrix.
- 29 frontend unit tests and 8 validation-runner regression tests.
- All 48 browser suites, including full demo and Time-title matrices.
- 103 Python packaging tests and four independent numerical/protocol suites.
- Native strict Clippy/build, headless CLI/MCP smoke, packaged app launch, and
  10 native GUI checks across seven terrain scenes. Each settled native scene
  rendered at most two frames over 1.3 seconds.
- Persistent-browser runtime startup/options/live-page/cleanup smoke.

The first full invocation exposed four browser failures. Focused reruns verified
fixes for hidden preset controls, asynchronous dock resizing, circular north
rounding, and idle readiness. Headless Chrome/Metal closed twice during combined
pixel readbacks; fresh per-mode browsers pass all pixel assertions. Separate
integration/parity suites retain continuous mode transitions. Native captures
now enter a real workspace before measuring terrain, avoiding the Welcome overlay.

[results.json](results.json) records the latest passing result for every check,
source hashes for all browser suites, original failures and individual run IDs.
These results combine a full run with focused reruns; neither failed invocation
was overwritten or relabeled as passing. Detailed logs/screenshots remain in
`.qa/test-streamlining/runs/<run-id>/` on this Mac.

Commands used (with the local build environment and Python oracle dependencies):

```sh
python3 scripts/validate_local.py --browser
python3 scripts/validate_local.py --tier full --native-gui
python3 scripts/validate_local.py --tier full --suite integration-smoke --suite welcome --suite charts --suite navigation-sphere --suite space-time-window --suite cesium-effects-pixels --native-gui
python3 scripts/validate_local.py --suite charts --suite cesium-effects-pixels --skip-build
```

Optional heavy benchmarks, experimental WebMCP integration, device/model and
certificate hardware checks, other operating systems, and downloaded release
acceptance were not run. GitHub Actions remain manual-only. No Public promotion
is part of this change.
