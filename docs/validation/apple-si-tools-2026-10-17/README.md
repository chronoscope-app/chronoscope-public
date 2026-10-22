# Apple SI tools and Rust analytics — 2026-10-17

Implemented against canonical Chronoscope main `72c5cec`. All verification ran locally; no GitHub workflows or runners were dispatched.

- **265 Rust tests passed** across the library and all integration targets. This includes private-pipe round trips, preserved caller context, timeout/cancellation, frame/call limits and replay rejection; real query/schema discovery; edit grants; exact UTC projections/year grouping; known-answer statistics; empty/missing/constant/pairwise cases; full filtered/selected scope; and 25,000-row full-scope statistics with bounded results.
- `cargo clippy --locked -p chronoscope --all-targets -- -D warnings` passed.
- Production TypeScript/Vite build and generated CLI/MCP contracts passed. Vite retains its existing Cesium/MapLibre chunk-size advisory.
- The real Rust bridge plus Chromium hosted-SI regression passed, including record tools, permissions, external MCP modern/legacy discovery and calls, import aggregation, preview/apply/undo, triangle picking and all-view rendering. Zero public WMTS requests. The fixture expectation was updated from AI service to the UI’s SI service label.
- `python3 scripts/test_analytics.py` passed on the bundled 1,604-Event hurricane workspace. Python's independent standard-library mean/variance/sample deviation/correlation matched Rust; actual stdio MCP statistics matched CLI output. Exact UTC-year totals matched every queried Event. No public requests and no Python app-runtime dependency.
- Official Apple documentation was checked for native `Tool`, session construction, writable transcript and token/context APIs. The opt-in `npm --prefix frontend run test:apple-local` now verifies actual model tool evidence, Event IDs, year counts, Rust statistics, generic selection and a permissioned tag edit, alongside normal conversation and cancellation.

**Not verified here:** Swift/Apple SDK compilation, actual Foundation Models tool selection/context behavior, Mac WebView behavior or a native installer. This Linux environment cannot perform those checks. The Mac test remains pending; no mocked inference is presented as native validation. Pull and rebuild on Mac before evaluating the new provider.

See [implementation and usage](../../APPLE-SI-ANALYTICS.md), [target-by-target results](report.json) and [hurricane oracle](hurricane-analytics.json).
