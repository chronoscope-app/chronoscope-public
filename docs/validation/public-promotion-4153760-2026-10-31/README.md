# Tested Next source promotion — 31 October 2026

Owner-authorized promotion of Next `4153760745af689b9625a5a5630873bd5b33a888` (0.16.10) onto Public's existing history. Every tracked Next file is byte-identical; Public-only validation records are preserved. Retired IDF previews and the 42 MB demo asset are removed, and the complete KABR flight demo is included alongside navigation, DMS coordinates, radius selection and layer workflow updates.

Local Windows verification passed 489 Rust tests (one ignored), all 76 integration targets, 175 frontend tests, 16 browser suites, generated contracts and seven native app checks. The initial timed Cargo invocation was continued for its interrupted and remaining targets. The source gate is **not fully green**: ten symlink-fixture errors across three Python suites require privileges unavailable in this Windows session. Direct native input automation could not activate the captured window; native MCP and browser input checks passed. The stale IDF changelog description is retained to preserve exact tested-source parity.

The [structured record](report.json) identifies the source, Public parent, exact Windows binary hash, checks and limitations. This is a source promotion. Existing downloads, tags, release assets and manual-only workflows are preserved; no hosted runner was dispatched.
