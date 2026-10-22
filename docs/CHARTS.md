# Charts

Open **Charts**, the second inspector tab after Views. The plot opens beside the map in a wider, resizable pane. The map and source attribute table remain interactive. Drag the existing inspector divider; arrow keys resize it, Shift increases the step, and Enter/double-click resets it. **Compact chart** restores normal inspector sizing. Chart and ordinary inspector widths are remembered separately on this device.

## Eight one-click starting points

- **Compare groups** counts Events by the first explicitly assigned Category field, falling back to Entity (or Category/Source when an earlier fallback is excluded).
- **Change over time** counts Events in explicit UTC intervals. The initial interval is chosen from the dataset time span to keep the estimated number of marks manageable; this is a display estimate, not a statistical inference. Inspect/change the interval under Customize.
- **Distribution** builds a histogram of a suggested numeric measurement.
- **Relationship** plots two suggested numeric measurements. Explicitly assigned measurements take priority; otherwise imported measurements are preferred over pairing a duplicate canonical Value with its source column.
- **Compare spread** uses a Tukey boxplot to compare a suggested measurement across the preferred Category field (falling back to Entity). It shows median, quartiles, observed whiskers and bounded outlier points.
- **Repeating patterns** shows a 7 × 24 grid of recorded Event counts by UTC weekday and hour. It uses the canonical Event clock and needs no numeric measurement. Customize can use End time or change counts to sum, mean, minimum or maximum of a measurement. Empty count cells show zero recorded Events; an empty numeric cell means no measurement, not a measured zero. Sampling schedules affect these patterns: they do not by themselves establish real-world activity.
- **Composition over time** stacks Event counts by the preferred Category field (falling back to Entity), with a conservative initial UTC interval allowing for up to 32 displayed groups. Sparse series share timestamp keys. Missing counts are filled with zero only when the entire chart has been returned; omitted marks or missing measurements stay unknown. Customize changes grouping, interval, calculation and stacking.
- **Compare periods** creates paired bars by the preferred Category field (falling back to Entity). By default Rust splits the chosen scope/layer's time extent into two adjacent windows and includes the final sample. **Comparison periods** lets you enter full UTC start/end dates, including seconds and fractions, then **Apply periods**. Starts are inclusive and ends exclusive, so an Event at an adjacent boundary belongs only to the later period. **Use automatic halves** restores dynamic defaults. Manual periods must be positive-length and non-overlapping; they may be in either chronological order. Different durations are disclosed; counts and totals are not normalized by duration. The plot, tooltips and compact result table show A, B, B − A and percentage change `(B − A) / abs(A) × 100`. Percentages are undefined if A is zero or either value is missing. Absent group/window combinations produce zero for counts, and missing for measurements. Scoped Events outside both windows are reported separately from unusable measurements.

The eight shortcuts use two rows of four in a wide chart pane, or four rows of two in a narrow pane. Unsupported starters explain whether they need a grouping field or numeric measurements. All four new shortcuts retain the chosen scope and source layer; none enables spatial heat maps or bloom. Pattern grids and comparisons use the same exact map/table selection as other charts. Period comparisons retain whole pairs when the display budget is odd.

Suggestions use actual finite-numeric schema counts. Coordinate, calendar and identifier-named columns are excluded from measurement starters. Names do not prove semantic meaning; inspect your source. Starters needing more measurement columns are unavailable; **Customize** still exposes all supported numeric fields. Selecting a starter replaces the chart configuration while retaining the chosen scope and layer. Source records and filters are untouched.

The normal entry screen keeps the detailed editor collapsed. Choose **All Events**, **Filtered Events**, or **Selected Events**. Selected Events also respects current filters. A layer selector appears for multiple Event layers. **Customize** exposes chart types, fields, grouping, calculations, UTC intervals and more options, including second axes, stacking, trendlines, histogram bins and the mark budget.

## Assign field roles

Choose **Field roles…** below the chart. Search canonical or original imported column names, choose roles, then **Apply roles**. **Assigned only** focuses the list on your choices. Large schemas initially render 100 matching rows; **Show 100 more** expands the list. Numeric availability counts cover the entire dataset, irrespective of current chart filters.

| Role | Effect on starters |
|---|---|
| Automatic | Uses the existing name and numeric checks. |
| Measurement | Takes priority for Distribution, Relationship and Compare spread, even with an unusual name such as `Year`. Actual numeric values are still required. |
| Category | Preferred grouping for Compare groups, Compare spread, Composition over time and Compare periods; numeric category codes remain categories. |
| Identifier | Excluded from numeric measurement suggestions, including numeric account or device IDs. |
| Date/time | Describes a time-reference column and excludes it from numeric measurement suggestions. |
| Coordinate | Excludes a location/reference column from numeric measurement suggestions. |
| Currency / unit | Describes a code/reference column and excludes it from measurement suggestions. |
| Exclude from suggestions | Prevents automatic measurement/grouping selection of that field. |

Roles guide starters; existing charts keep their configured fields. Customize remains available for explicit field choices. When several fields qualify, starters use the deterministic schema/name order; Customize chooses a different field. A Measurement role on an entirely text column remains an annotation: the starter stays unavailable for that column, and no text is coerced into numbers.

Roles never change source values, track identity, import mapping, unit conversions or Event timestamp precision. Date/time roles do not replace the canonical Event clock: choose/remap that clock in the import mapping. A Currency/unit role does not automatically associate or convert currency values in an amount column; use the chart's labels for known units. The existing calculation precision is unchanged.

Roles belong to the dataset, travel in `.chronoscope` files, and support normal undo/redo. Saved views do not overwrite dataset roles. Choose **Automatic** to reset one field without changing other assignments. Cancel discards unapplied choices. Conflicting changes to the same role from another client are disclosed before applying.

## Understand the plot

The active saved chart's name appears above the plot. Otherwise its title describes the calculation and fields. Time ticks include calendar context and always use UTC. The caption shows scope, chart type and time interval.

When canonical Value has explicit `value_unit` or `value_description` source attributes, Rust verifies those declarations against the full chart scope. An automatic label is used only when that attribute has exactly one consistent, nonblank value on every scoped Event. Mixed or partial unit declarations produce a warning and no automatic unit; absent metadata produces no automatic unit. Imported field names remain visible; arbitrary units are never guessed from numeric values or a few examples.

Use **Customize → Title, labels and units** to name the plot and axes. These labels do not convert measurements or their units. They travel with chart presets, saved views and `.chronoscope` files. Changing a field clears its custom axis label so an old unit does not carry over to a different field. Switching between chart types with different axis meanings also clears axis labels; switching among bars, lines and areas preserves them.

## Missing measurements and busy charts

Charts report the scoped and excluded Event counts. A chart with no usable measurements offers **Show Event counts over time**, preserving the current scope/layer. An empty Selected scope explains how to select Events or choose another scope.

If the plot reaches its mark budget, it clearly states that only some marks are displayed. Time charts offer an explicit coarser interval, such as daily instead of hourly; this never happens silently. Otherwise narrow grouping/filters or change the mark limit in Customize. Calculations run over the complete scope; the rendering budget does not sample source records. No automatic deletion or outlier filtering occurs.

For numeric charts, the source measurement range is shown. **Inspect spread and outliers** changes the plot to a Tukey boxplot grouped by entity, retaining the numeric field and scope. Boxes show quartiles and median, observed whiskers within 1.5 IQR, and bounded outlier marks. A large or unusual value is not automatically an error. Missing values and extreme readings in the wildlife samples remain unchanged.

## Link charts to the workspace

The chart's **Save chart as PNG** toolbox icon exports the current plot at twice its displayed resolution, with a background matching the theme. This uses Apache ECharts' native export; labels, axes and the current chart zoom are included. Source Events and workspace filters are unchanged.

Click a mark to select its exact original Events. Shift-click adds. Scatter charts have a rectangle brush in the plot tools; selection applies once after the drag ends. Ctrl-scroll zooms the chart. **Select displayed Events** selects the source Events represented by displayed marks, not every scoped Event when marks are limited. **Chart data** provides accessible values for both Y axes and row selection. Selecting a data row or all displayed Events includes evidence from both axes, including Events whose primary measurement is missing. Clicking a plotted mark selects evidence for that mark's axis only.

**Open attribute table** opens the normal shared source table. Its selection matches the map and chart selection. **Saved charts** stores named configurations without exporting a separate dataset. Statistics describe Events, which need not be independent animals or entities; a relationship or trendline does not establish causation.

## CLI, MCP and SI

Charts and analytic tools share UTC calendar bucketing through `chrono`, compensated sum/mean aggregates through `accurate`, histogram bin assignment and inclusive quantile interpolation. Calculations stay in Rust/SQLite over the full scope. Boxplot whiskers remain observed values within the Tukey fences; library-specific default quantiles or fence-position whiskers are not substituted. Analytics cache keys include the calculation version so results from earlier numerical implementations are not reused as new calculations.

The existing `chart_data`, `view_set`, `scene_sync` and `select_query` commands retain their calculation/selection semantics. Chart configs also accept bounded presentation strings `title`, `x_label`, `y_label` and `y2_label` (maximum 256 characters). `chart_data` returns optional verified `value_metadata`, the source `value_extent`, and `outside_period_count` (zero for other charts). `dataset_schema` includes exact canonical `numeric_counts` when `include_attribute_types` is true. These operations remain local Rust/SQLite calculations, available through CLI/MCP and SI tool discovery; no model calculates the statistics.

`field_roles_set` atomically patches exact field names. Use a role string to assign, or `null` to reset to Automatic. It supports `expected_revision`, dry-run, idempotency and atomic batches. It changes workspace metadata and requires SI edit permission. `dataset_schema.field_roles` reports canonical roles plus roles for the returned attribute page; `snapshot.field_roles` contains all assignments. At most 512 assignments and 256 KiB of names are retained.

```sh
chronoscope --attach call field_roles_set --args '{"assignments":{"attribute:Amount":"measurement","attribute:Account":"identifier","attribute:Merchant":"category","attribute:Currency":"unit"}}'
```


The additional Rust chart kinds use the same public command across CLI, MCP and SI:

```sh
chronoscope --attach call chart_data --args '{"config":{"kind":"heatmap","x":"time","x_axis":"time","aggregate":"count","scope":"visible"}}'
chronoscope --attach call chart_data --args '{"config":{"kind":"period","x":"entity","aggregate":"count","scope":"visible"}}'
chronoscope --attach call chart_data --args '{"config":{"kind":"period","x":"category","aggregate":"mean","y":"value","period_a":[1767225600,1769904000],"period_b":[1769904000,1772323200]}}'
```

Heatmap rows use hour `x` (0–23) and Monday-first weekday `series` (0–6), at most 168 cells. Period rows use the grouping key `x`, `series:0` for A or `series:1` for B, and Rust-computed `before`, `after`, `change` and `percent_change`. The returned config contains the resolved windows even when the requested windows were automatic; pass that returned config and revision to `select_query` to select exactly the displayed evidence. Configs, presets and saved views retain null windows for automatic mode, or exact explicit windows for manual mode. All calculations use the full scope in the existing disk-backed Rust/SQLite pipeline. The mark/response limits bound display output rather than sampling the data. These charts add no dependencies.
