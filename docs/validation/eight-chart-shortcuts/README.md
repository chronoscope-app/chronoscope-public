# Eight chart shortcuts — local validation, 19 October 2026

Charts now offers Compare groups, Change over time, Distribution, Relationship,
Compare spread, Repeating patterns, Composition over time and Compare periods.
The wide pane uses a 2 × 4 grid; compact panes use two columns. Starters retain
the current scope/layer and honor field roles. Detailed controls remain under
Customize. See [Charts](../../CHARTS.md) for use and CLI/MCP examples.

## Dataset credit for the five Black Rock chart captures

Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project; [DOI 10.5441/001/1.652](https://doi.org/10.5441/001/1.652), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Chronoscope selected the Black Rock Forest March 2023 subset and aggregated/rendered the charts. Retain this credit with copied chart images; recorded counts do not establish animal activity. Exact image paths are listed in [the media ledger](../../MEDIA-RIGHTS.json).

## Calculations and interaction

- Spread reuses full-scope Tukey boxplots. Composition reuses grouped time
  aggregation, aligns sparse series to common timestamp keys and leaves
  omitted/missing measurements unknown.
- Repeating patterns aggregates UTC weekdays/hours in Rust/SQLite, with at most
  168 cells. Fractional timestamps immediately before a boundary and negative
  Unix epochs stay in the correct cell. Count zeros and missing measurements
  remain distinct. These are recorded sample counts, not inferred activity.
- Period comparison uses two non-overlapping `[start,end)` UTC windows. Automatic
  windows split the scoped/layer time extent and include the final sample;
  explicit windows retain seconds/fractions. Rust computes A, B, differences and
  percentages. Zero/missing baselines have undefined percentages; unequal
  durations and Events outside both windows are disclosed. Mark and response-byte
  limits preserve whole comparison pairs.
- Cells and bars select exact source Events, including Shift-click addition, with
  the normal map/table selection. Presets and portable workspaces retain chart
  kinds and explicit/automatic window settings. A chart switch cancels pending
  date validation safely. Tooltip delay belongs to the app so a delayed callback
  cannot outlive a disposed ECharts tooltip; legend hovers use the same delay.
- Both additional Rust chart kinds are available through the existing shared
  CLI/MCP/SI `chart_data` and `select_query` contracts. No dependencies were added.

## Evidence

- [Rust report](rust-report.json): **88 tests passed** across the library,
  analytics, scene, chart, field-role, timestamp and view/layer suites. Eight
  new chart tests include signed/zero/missing baselines, overflow, exclusive
  boundaries, pair budgets, portability and 100,000-Event aggregation. The
  latter verifies the exact sum of all 100,000 measurements in 168 cells and
  exact 50,000/50,000 automatic period counts in two bars.
- [Shortcut browser report](shortcuts-report.json): **13 checks passed**, including
  real pointer selection, a one-second tooltip hover, date validation during a
  chart switch, responsive pane widths, themes and portable save/reopen.
- [Existing workflow report](workflow-report.json): saved labels/units, pane
  resizing, scopes, presets, real animal datasets, missing-value guidance and
  ordinary table behavior.
- [Field roles report](field-roles-report.json): explicit measurement/category
  assignments, wide schemas, escaping, conflicts, history and portability.
- [General chart report](charts-report.json): imported measurements, stacking,
  second axes, trendlines, exact selection, histogram/boxplots, native rectangle
  brushing, presets and stable full-range playback.
- [CLI/MCP report](protocol-report.json): live stdio discovery, grid calculation,
  exact selection, Rust-computed period changes and CLI/MCP result parity.
- TypeScript/Vite production build, generated contract consistency, formatting,
  core Clippy (with the pre-existing `too_many_arguments` exception) and native
  Linux `cargo check --locked --workspace` passed. All checks ran locally;
  no GitHub runner was used.

Reproduce with `npm --prefix frontend run test:chart-shortcuts`,
`npm --prefix frontend run test:charts`,
`npm --prefix frontend run test:chart-workflow`,
`npm --prefix frontend run test:field-roles`, and
`python3 scripts/test_chart_shortcuts_protocol.py` after building the CLI and UI.
Rust checks use `cargo test --locked -p chronoscope --lib --test analytics_engine
--test cesium_scene --test chart_shortcuts --test charts --test field_roles
--test subsecond_precision --test views_layers -- --test-threads=1`.

## Actual app captures

These are unretouched Chromium captures of the application frontend connected
to the actual Rust engine, using the bundled public bobcat/fisher dataset
(3,439 Events). They are not image-generation concepts. Map requests were
disabled for these chart tests: **zero public requests** in the shortcut run.

- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)

The Linux VM uses software rendering. This verifies calculations, browser
interaction, layout and the native Linux build, not macOS runtime behavior or
hardware-GPU frame rates. The 100,000-Event check measures analytical correctness
with bounded output, not map FPS.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
