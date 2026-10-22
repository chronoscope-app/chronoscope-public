# Analytics engine validation — 2026-10-17

Local Linux CPU verification; no hosted runners, public map requests or physical GPU. This tests data processing and browser integration, not macOS Foundation Models inference. No new Mac installer was built here. The optional Linux Tauri compilation check was blocked by missing GLib development/pkg-config files in this container; desktop packaging was not validated.

- **278 Rust tests** across the library and integration targets, including known answers for all nineteen analytic capabilities, 200,001-Event full-scope/budget tests, concurrent edits, project replacement, cancellation, source staleness, output limits, save/reopen and SI orchestration. The report combines the full suite with final reruns of the changed library/analytics/SI areas.
- `cargo clippy --locked -j 1 --all-targets -- -D warnings`, `cargo fmt --check`, generated contract freshness and frontend production TypeScript/Vite build passed.
- Independent NumPy/SciPy/scikit-learn calculations matched actual Rust CLI/MCP results over 1,604 bundled public Atlantic hurricane Events. Covers exact quantiles/histograms, one-sample/Welch tests and intervals, OLS coefficients/fit, PCA variance/basis, calendar denominators and storm/year maximum preparation.
- Offline Playwright against the real Rust bridge passed result charts/tables, exact source-Event selection, stale results, artifact removal, save/reopen and dark/light theme rendering. No page errors or external HTTP requests.

Reproduce with `cargo test --locked -p chronoscope` (run individual targets sequentially on disks with little free space), `python scripts/test_analytics_engine.py` (optional NumPy/SciPy/scikit-learn QA dependencies), and `npm --prefix frontend run test:analytics` after building the CLI/frontend. These Python packages are not application dependencies.

On supported macOS, run `npm --prefix frontend run test:apple-local` to test actual native discovery/describe/run and result links. Linux tests verify the Rust tool grants, native framed-protocol harness and bounded results, but cannot establish Swift SDK compatibility or the model's ability to choose valid plans.
