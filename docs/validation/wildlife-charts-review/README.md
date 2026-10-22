# Wildlife and charts revision review

Tested `4de556ae7d05c06e571882acedd041ddb7fa87fb`, the latest main revision when this review started. The findings below distinguish verified fixes from recommended UI changes. The review used the actual Rust engine, authenticated browser bridge and production frontend, with Chromium/SwiftShader on Linux. GitHub runners were not used.

The chart workflow recommendations below were subsequently implemented; see the [current charts guide](../../CHARTS.md). This report retains the original revision’s findings.

## Results

- All **315 Rust tests** passed. This includes chart calculations, field profiles, pattern scans, GIS accuracy, portable projects, CLI/MCP access and the new demos.
- **118 browser check groups** passed: charts (9), timezone rendering (4), demos (21), Cesium parity (34), event tables (14), SI/MCP settings (5), patterns (8), sidebar/time/layout (8), empty startup (5), playback (7), and map notifications (3). Reports are alongside this document.
- Independent Python calculations checked **all 40,727 animal records** against their CSV/project pairs. Original attributes, coordinates, canonical Values, minute timestamps and derived end timestamps agreed. Counts, means, sums, minima/maxima, daily maxima, histogram counts, inclusive quartiles and Tukey whiskers agreed with the Rust chart engine. Histogram selection produced the exact original Event IDs; All, Visible and Selected scopes and portable reopen also passed.
- The full browser suite exercised actual chart clicks and slow brush drags, table/map linking, saves/presets, three geographic views, WKT, clustering/declustering, heat/bloom, DTED, imagery transitions, imports, playback, field-based facets, resizing, settings and local MCP fixtures.
- Playback's 24 rate/increment combinations, live rate continuity, UTC timeline labels, generated contracts, formatting and the production build passed.

The Python reference results cover gulls (15,697 Events), bobcats/fisher (3,439), storks (6,090) and seals (15,501). The latest three wildlife additions account for 25,030 of those Events. No model calculated these statistics.

Seal chart dates group dives by their published dive-start timestamps. Value is the maximum depth during each dive, not depth at its start or the time/location at which that maximum occurred. Modelled dive-start locations are retained as such; Space-time height still represents time.

## Confirmed defects fixed

**UTC chart labels were using the computer's local timezone.** The Rust daily buckets and chart tooltips used UTC, but ECharts' time axis used its local-time default. The first seal bucket, 22 February 2004 at 00:00 UTC, became 21 February at 19:00 on a New York axis; the final day's label also changed. `useUTC: true` now makes the axis consistent with the data and timeline. Time axes explicitly say UTC. The new regression test renders the same seal chart in UTC, New York (including the period's daylight-saving change), and Tokyo and compares its actual axis labels.

**A slow scatter brush could miss or prematurely apply selection.** The first debounced brush preview disarmed selection, even if the rectangle had not reached any points. The reproduction expected 407 source hurricane Events but selected none. Chart selection now waits for native ECharts `brushEnd`, then consumes the final native brush-selection result once. The regression deliberately pauses between drag steps beyond the debounce interval, verifies no selection writes while held, and verifies one exact selection after release without redraw loops.

**The standalone playback clock test could not resolve a newly imported dependency.** Transpiling one TypeScript file into a data URL left its `./tooltips` import without a filesystem base. The test now bundles the real module and its imports. esbuild was already used by Vite; it is declared explicitly as a development dependency for this test. No new runtime library was added.

`charts-before.json` and `charts-after.json` retain the two interactive chart reproductions. The source calculations were correct before these display/interaction fixes.

## Chart usability findings — recommended next work

1. **Start with the user's question.** The initial seal chart shows eight selectors before the user gets help deciding what to plot: chart type, records, layer, X, Y, calculation, series and interval. Offer simple starting choices: **Compare groups**, **Change over time**, **Distribution**, and **Relationship**. Choose suitable fields/calculations from the real schema; keep the full editor under Customize. Hide the layer selector when there is only one layer, and label scopes as All Events, Filtered Events and Selected Events.
2. **Make the chart's meaning explicit.** The useful saved seal preset is named “Daily deepest dive (m),” but the expanded chart is titled “value by time,” its Y axis says “value,” and the name is buried under Saved charts. Surface the active preset/title, calculation, units and time interval above the plot. Prefer “Daily maximum dive depth (m)” or “Average ground speed (m/s)” when metadata supports that meaning. Otherwise let the user provide labels; do not invent units. Time ticks also need enough month/year context to stand alone.
3. **Give charts room without covering the map.** The initial preview is confined to the narrow inspector. Expand provides a useful chart, but its modal hides the geographic result of linked selection. A larger resizable/dockable chart workspace beside the map would make the existing selection capability easier to use. Keep a clear hint for click/brush selection and additive modifiers.
4. **Offer useful empty-state and density defaults.** All 6,090 stork Values are intentionally empty: this source does not provide speed. A distribution of Value correctly has no marks, but the UI should suggest Event counts over time or another measured field. For high-cardinality time charts, suggest a coarser explicit time bucket instead of leaving the user to discover the displayed-mark cap. Make clear when Select chart records means the displayed marks rather than every scoped record.
5. **Expose data quality without silently changing it.** The gull data contains 86 missing Values and an extreme original ground-speed value of approximately 283.3 m/s. Those source values were preserved correctly. Show units, missing counts and an easy distribution/boxplot choice so an extreme value does not obscure ordinary movement; do not silently remove it or treat the sample as a validated ecological conclusion.

These are proposed workflow changes, not a completed chart UI redesign. Apache ECharts and the existing Rust calculations can support them; changing chart libraries is unnecessary.

## Outstanding quality check and limits

Strict Clippy (`cargo clippy --all-targets -- -D warnings`) reports an existing `too_many_arguments` warning for the ten-argument finding-construction helper at `src/pattern_scan.rs:236`. This review leaves that unrelated helper unchanged; `strict-clippy.log` records the failed check. It is a code-maintenance issue, not a failed numerical test. All runtime checks listed above passed.

Browser graphics were software-rendered. These checks establish functional behavior, not hardware-GPU FPS or native macOS/Tauri behavior. Apple Foundation Models inference and native certificate/smartcard prompts were not available on this Linux host. SI/MCP settings used deterministic local fixtures rather than a billed provider. Public WMTS services were not exercised; map tests used local fixtures, bundled imagery or disabled maps.

## Reproduction

Build the CLI and frontend first. Browser tests accept `CHRONOSCOPE_CHROMIUM` and `CHRONOSCOPE_QA_DATA_DIR` (some use `CHRONOSCOPE_QA_OUT`) to select a browser and retain screenshots/reports in an isolated profile.

```sh
cargo build --bin chronoscope
npm --prefix frontend run build
npm --prefix frontend run test:charts
npm --prefix frontend run test:charts-timezone
npm --prefix frontend run test:real-demos
npm --prefix frontend run test:cesium
npm --prefix frontend run test:event-table
npm --prefix frontend run test:si-settings
npm --prefix frontend run test:patterns
npm --prefix frontend run test:sidebar-time
npm --prefix frontend run test:empty-workspace
npm --prefix frontend run test:playback-speed
node frontend/scripts/map-notifications-qa.mjs
node frontend/scripts/timeline-labels-test.mjs
node scripts/generate_contracts.mjs --check
cargo fmt --check
```

The Rust suite was run as the library plus each integration target in `rust-report.json`, sequentially, deleting completed test executables between targets to fit the cloud workspace disk budget. There was no source sampling in the independent animal-data checks. Screenshots remain available in the individual test output folders.
