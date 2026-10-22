# Guided chart workflow validation

Based on `24baf638dfef7a4a89443936e0dcc52492ea470a`. This implements the chart usability recommendations from the [wildlife review](../wildlife-charts-review/README.md). See the [user guide](../../CHARTS.md).

## Changes

- Four question starters, based on actual numeric schema counts. The full editor starts collapsed; a single-layer workspace initially shows only the Event scope selector.
- A larger chart beside the map, using the existing keyboard/pointer pane divider. Chart widths and ordinary inspector widths are stored separately on the device. The modal chart and duplicate renderer have been removed.
- Active preset names, calculation labels, explicit UTC calendar ticks and portable custom titles/axis labels. These strings are bounded, exposed through the engine contracts and never used in calculations.
- Rust verifies explicit source Value units/descriptions against every record in the same scoped read used for the chart. Mixed/incomplete declarations are not applied, produce a warning and never trigger an implicit unit conversion. Count-only charts do not acquire unrelated measurement descriptions. Metadata adds no second workspace copy or frontend record download.
- Missing-measurement and empty-selection guidance, explicit coarser time intervals for limited charts, clear selection coverage, source ranges and a one-click Tukey boxplot. Original values and source Events are retained.
- Updated in-app Help, a chart guide, generated CLI/MCP contracts and browser regression scripts. The fresh-load test explicitly replaces/reloads the document rather than navigating to the same URL fragment.

## Verification

- **15 targeted Rust tests**: nine chart tests and six field-profile tests. They verify exact calculations, source selection, histogram/boxplot semantics, portable labels, label length limits, uniform/mixed/partial unit declarations and canonical counts.
- **32 browser check groups**: charts (9), guided wildlife workflows (11), UTC timezone rendering (4), and sidebar/time/layout (8). JSON reports are alongside this document.
- Wildlife workflows exercise all **40,727 Events** across seals (15,501), storks (6,090), gulls (15,697) and bobcats/fisher (3,439). Seal units come from the explicit source `value_unit`; gull files have no such declaration and receive no guessed automatic unit. Stork Value is intentionally empty. Gulls retain all 86 missing Values and the original approximately 283.3 m/s extreme described in their source documentation.
- Actual slow native ECharts brush gestures select exact source IDs once after release, without preview writes or redraw loops. Table/map linking, full-scope statistics, presets, save/reopen and playback caching pass.
- The chart divider responds to keyboard/pointer input without rerunning analytics. Ordinary pane sizing, table layout, fullscreen and light/dark themes pass at 1600px and 1000px widths.
- Production TypeScript/Vite build, generated contracts, Rust formatting, changed frontend file formatting, playback-clock checks, timeline-label checks and diff whitespace checks pass.

The tests run locally on Linux using Chromium/SwiftShader and the real Rust engine. Public map requests are blocked and maps use bundled/local assets or are disabled. No GitHub runners or billed SI services were used. Native macOS/Tauri behavior and hardware-GPU FPS were not measured. The previously documented strict-Clippy `too_many_arguments` warning in `src/pattern_scan.rs` is unchanged and outside this chart change.

## Reproduce

```sh
cargo build --locked -p chronoscope --bin chronoscope
npm --prefix frontend run build
cargo test --locked -p chronoscope --test charts
cargo test --locked -p chronoscope --test field_profile
npm --prefix frontend run test:charts
npm --prefix frontend run test:chart-workflow
npm --prefix frontend run test:charts-timezone
npm --prefix frontend run test:sidebar-time
node frontend/scripts/playback-clock-test.mjs
node frontend/scripts/timeline-labels-test.mjs
node scripts/generate_contracts.mjs --check
cargo fmt --check
```

Browser scripts accept `CHRONOSCOPE_CLI`, `CHRONOSCOPE_CHROMIUM` and `CHRONOSCOPE_QA_DATA_DIR` for the engine, browser and isolated output directory. Screenshots are retained by each script. Native Mac verification remains separate.
