# Public AI feature promotion — 2026-10-22

Owner-authorized promotion of the focused AI update from `chronoscope-next` commit `ee83f5c` onto the existing `chronoscope-public` main `3c1a876`. This promotion includes Explain result, reviewed tag suggestions, generic AI progress/cancellation, typed MCP UI actions and Apple SI Chat retirement. Connected-model SI Chat remains available.

The public repository has independent history and newer packaging fixes. The promotion applies only the AI change on top of public history. It preserves packaging scripts, Mac configuration, dependency manifests and both manual-only workflows byte for byte. The capabilities conflict retains public's actual GIS format list; the suite inventory excludes the unpublished development-only vector suite. No unrelated vector imports or private development ancestry are promoted.

Local public-tree verification passed: 87 targeted Rust tests (45 library, 8 analytics engine, 18 assistant aggregation, 4 focused AI, 6 pattern scan, 6 SI chat), strict Clippy without lint exemptions, production TypeScript/Vite build, generated contracts/help, suite inventory and all five focused AI browser checks with a loopback model. Browser checks made no public requests.

The focused feature modules and Apple bridge match the previously validated development build byte for byte. The earlier [native MCP evidence](../focused-ai-2026-10-22/README.md) records real on-device generation, UI busy/cancel states and tag apply/Undo. That report describes the development-stage validation before this separately authorized promotion.

No GitHub-hosted runners were started and no executable release was created. See [structured results](report.json).
