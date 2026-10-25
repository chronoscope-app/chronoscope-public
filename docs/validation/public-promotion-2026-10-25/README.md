# Source promotion — 25 October 2026

This promotion copies the validated Next source into Public main with Public main as its sole parent. Every tracked Next file is identical. The two prior Public promotion receipts are preserved unchanged; only the two current receipts are added. No Next commit ancestry is imported.

The user explicitly authorized promotion once the Mac checks passed, accepting the remaining Linux browser failures while clawcomp continues repairing them. Fresh Mac assistant, graphics-context and complete Cesium parity checks passed, as did the five focused browser suites, all 48 frontend cases, packaging/numerical checks and native 13 terrain/navigation plus five MCP checks. Parity passed in visible Chrome/Metal after headless Chrome closed at the polar switch; both runs remain documented. This is focused Mac verification, not a fresh 49-suite Mac sweep.

The frozen Intel/Linux run passed all 408 Rust tests, 46/49 browser suites, scale, both hardware benchmarks and native lint/build/CLI checks. It remains failed overall on assistant session synchronization, context-loss status and polar Map parity. Those Linux failures are accepted for this source promotion, not declared fixed. Radeon recovery was explicitly excluded. See [Mac checks and promotion decision](../intel-playback-mac-2026-10-25/README.md) and [Intel investigation](../intel-playback-latency-2026-10-25/README.md).

The exact tracked source snapshot passed the pinned, canary-checked Gitleaks scan with zero findings. Workflows remain manual-only; no hosted runners, release assets, tags or downloaded binaries were changed. [Structured receipt](report.json) records source provenance and limitations.

Fresh checks on the independent Public candidate also passed: source contracts, 48 frontend cases, 11 runner cases, browser integration smoke, 103 packaging cases and all four numerical/protocol suites. The final receipt amendment changes only promotion metadata. The final exact snapshot is rescanned before push.
