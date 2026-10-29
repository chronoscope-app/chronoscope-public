# Public source promotion 0.16.7 — 2026-10-29

Owner-authorized source promotion from Next/main `96c5734127de0c0514905aeb751dd482cac0d504` onto Public/main
`8dfd13057fe940ca519b3f4a8d0f2e1e9fe4b2f5`. All 3,280 tracked Next files are copied byte for byte; Public's
20 historical promotion files and independent Git history are retained.

The update includes streaming-import root enforcement, committed/workspace-bound
analysis reads, optimized local Mac builds and idle update limiting, light-marker
outline removal, the continuous Fade slider, and matching persistence/CLI/MCP.
[Promotion receipt](report.json).

The full local source/packaging gate passed: 478 Rust tests,
154 frontend tests, formatting, Clippy and packaging checks. One optional bundled
demo matrix remains ignored. Dependency audits reported zero vulnerabilities;
existing maintenance/yanked warnings remain recorded. Focused browser and installed
Mac CLI/MCP evidence is included in the
[fade validation](../fade-light-mac-2026-10-29/README.md). The source gate ran before
three final documentation-only edits; application files are unchanged.

Fresh native 0.16.7 captures/playback remain unverified: live requests timed out
under the locked session, including with an unchanged older control. No
computer-use input was performed. Other native platform acceptance is not claimed.

This promotion changes source only. Downloaded packages remain 0.16.4. No hosted
workflow, new release/tag, asset replacement or repository-setting change is part
of this action. Workflows remain manual-only. Ignored Starlink stress data stays
outside the source export. Exact candidate scan/parity evidence is retained locally.
