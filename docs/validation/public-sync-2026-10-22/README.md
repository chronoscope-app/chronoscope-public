# Complete validated source promotion — 2026-10-22

Owner-authorized promotion of **all validated updates** from `chronoscope-next` main `ee83f5c` onto `chronoscope-public` main `3e83a58`. The remaining feature gap was bounded Shapefile and vector GeoPackage ingestion. Public now includes its native reference layers, timestamped Events conversion, source attributes/provenance, portable source packaging, reader bounds, malformed-input tests, pinned dependencies, license notices, fixtures, documentation and browser evidence. The AI features promoted earlier remain included.

An exhaustive tracked-file comparison verifies parity with next. Only public's newer tester packaging script/tests, ad hoc Mac signing configuration and promotion records remain different. These public-specific files are preserved byte for byte. No validated application update is omitted. Both workflows remain manual-only and unchanged; public's independent Git history is retained.

Local verification on the final combined tree passed:

- 131 Rust tests across the library, analytics engine, assistant aggregation, focused AI, GIS files, import workspace, pattern scan, SI chat and vector GIS suites.
- 15 frontend unit tests, production TypeScript/Vite build, generated contract/help checks and suite inventory.
- Seven real-engine GIS browser checks: Open/import, exact source IDs and provenance, all three views, timestamped Events conversion, and portable reopening. Desktop CSP enforced; no external requests or page errors.
- Five focused AI browser checks covering progress/cancel, editable tag review/apply/Undo, explanations/evidence and stale-preview rejection. No public requests.
- 32 preserved tester packaging fixtures and 23 distribution/notice fixtures. The built notice payload verifies all 1,498 files.
- Clippy with only the previously recorded four GIS parser style categories exempted. The strict diagnostics were inspected first: exactly the five known unique findings in unchanged `src/gis/vector.rs`, repeated for library and library-test targets; no additional diagnostics.

The application implementation matches the already tested next build, including the earlier real Apple Intelligence/native MCP checks. This promotion creates no executable release and starts no hosted runner. See [structured results](report.json), [GIS documentation](../../VECTOR-IMPORTS.md) and [earlier AI native evidence](../focused-ai-2026-10-22/README.md).
