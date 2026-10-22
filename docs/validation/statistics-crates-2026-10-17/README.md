# Crate-backed statistics — local validation, 2026-10-17

Replaces custom statistical accumulators with average 0.17.0 and accurate 0.4.1. The app's dataset summaries and agent statistics share the backend; the legacy in-memory helper also uses these libraries. Source filtering, schema/permission validation, missing/undefined policies and result contracts remain in the Rust engine. Exact median lookup stays indexed in SQLite.

- **268 Rust tests passed** across the library and all integration targets. The final library/analytics targets (39 + 9 tests) passed again after strengthening the Pearson zero-result range guard.
- Nine analytics tests cover known population/sample moments, correlation, filtered/selected/source scopes, missing data, empty/constant cases, SQL/schema validation, UTC/calendar handling, 25,000-row full-scope results, compensated cancellation residuals, UI/tool consistency and Pearson numeric range failure instead of false zero.
- All-target Clippy with warnings denied passed. CLI build, generated contracts and production TypeScript/Vite build passed. Vite retains its existing large-chunk advisory.
- Independent Python standard-library arithmetic over every bundled hurricane Event matched Rust; actual stdio MCP matched CLI and UTC-year totals. This test oracle does not add Python to the app runtime.
- Hosted-SI/real Rust bridge/Chromium regression passed, including external MCP modern/legacy calls, permissions, aggregation and all-view rendering. Zero public WMTS requests. Linux uses software rendering.
- Both direct libraries' upstream MIT texts were copied unchanged into assets/licenses, and the production frontend's packaged copies match them byte-for-byte.

No Mac, Windows, Foundation Models, dedicated GPU or installer tests were run for this change. No Swift bridge or native packaging code changed; existing Mac model validation remains separate. No GitHub workflows or runners were dispatched.

See [dependency decisions](../../STATISTICS-CRATES.md), [proposed broader architecture](../../ANALYTICS-ARCHITECTURE.md), [test targets](report.json) and [hurricane arithmetic oracle](hurricane-analytics.json). The broader architecture is a design proposal; its planned libraries and capabilities are not advertised as delivered features.
