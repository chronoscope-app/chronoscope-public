# Charts

Open **Charts**, the second inspector tab after Views. The plot opens beside the map in a wider, resizable pane. The map and source attribute table remain interactive. Drag the existing inspector divider; arrow keys resize it, Shift increases the step, and Enter/double-click resets it. **Compact chart** restores normal inspector sizing. Chart and ordinary inspector widths are remembered separately on this device.

## Chart first

The chart toolbar is one row of eight icons, with accessible names and tooltips: **Line**, **Bar**, **Histogram**, **Scatter**, **Heatmap**, **Box plot**, **Stacked area**, and **Period comparison**. Charts is enabled in both the inspector tabs and the collapsed inspector rail. A workspace saved on Charts reopens on that pane.

Choose the Event scope and the **X axis** and **Y axis** directly above the plot. Axis choices come from the actual dataset schema, including imported fields. A numeric Y field uses the current calculation, or Average when switching from Event count. Choose **Event count** in the Y selector to count records instead. Chart switches retain compatible measurement, category and clock choices, as well as scope and source layer. Incompatible choices receive schema-backed defaults; the source records and filters are unchanged.

- **Line** shows change over time by default; X can use another supported field. UTC intervals are under Chart options.
- **Bar** compares categories or supports numeric/time axes. Choose the grouping field on X and counts or a measurement on Y.
- **Histogram** chooses its measurement on X; Y is the fixed Event count. Bins are under Chart options.
- **Scatter** chooses numeric fields independently on X and Y. Chart options offers the full-scope OLS trendline.
- **Heatmap** has fixed UTC hour and weekday axes. Chart options chooses the clock (Time or End time) and the cell value. Empty counts are zero; empty measurements are unknown. Recorded counts do not establish real-world activity.
- **Box plot** chooses a grouping field on X and a measurement on Y. It shows median, quartiles, observed Tukey whiskers and outliers from the full scope.
- **Stacked area** starts with counts over time grouped by the preferred category. Series, interval and measurement controls support composition charts; omitted or missing measurements stay unknown.
- **Period comparison** chooses a grouping field on X and counts or a measurement on Y. Automatic periods split the scope's time extent. Chart options → Comparison periods accepts two full UTC date/time windows. Starts are included and ends excluded. Counts and sums are not normalized for duration; unequal durations are disclosed. Percentages are undefined when the baseline is zero or either measurement is missing.

Types needing unavailable measurements or grouping fields explain why they are disabled. Suggestions honor field roles and actual finite-numeric schema counts. Coordinates, calendar fields and identifier-like columns are excluded from measurement suggestions; explicit axis selectors still expose supported fields. A layer selector appears when the workspace has multiple Event layers.

**Chart options** contains only the relevant calculation, series, UTC interval, bins, trendline or comparison periods. Advanced settings retain second axes, stacking, explicit axis scales, the mark limit and field roles. Title/axis labels and named saved charts remain available without a second chart-type picker.

## Assign field roles

Choose **Chart options → Advanced → Field roles…**. Search canonical or original imported column names, choose roles, then **Apply roles**. **Assigned only** focuses the list on your choices. Large schemas initially render 100 matching rows; **Show 100 more** expands the list. Numeric availability counts cover the entire dataset, irrespective of current chart filters.

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

Roles guide starters; existing charts keep their configured fields. Explicit axis selection remains available for explicit field choices. When several fields qualify, starters use the deterministic schema/name order; The axis selector chooses a different field. A Measurement role on an entirely text column remains an annotation: the starter stays unavailable for that column, and no text is coerced into numbers.

Roles never change source values, track identity, import mapping, unit conversions or Event timestamp precision. Date/time roles do not replace the canonical Event clock: choose/remap that clock in the import mapping. A Currency/unit role does not automatically associate or convert currency values in an amount column; use the chart's labels for known units. The existing calculation precision is unchanged.

Roles belong to the dataset, travel in `.chronoscope` files, and support normal undo/redo. Saved views do not overwrite dataset roles. Choose **Automatic** to reset one field without changing other assignments. Cancel discards unapplied choices. Conflicting changes to the same role from another client are disclosed before applying.

## Understand the plot

The active saved chart's name appears above the plot. Otherwise its title describes the calculation and fields. Time ticks include calendar context and always use UTC. The caption shows scope, chart type and time interval.

When canonical Value has explicit `value_unit` or `value_description` source attributes, Rust verifies those declarations against the full chart scope. An automatic label is used only when that attribute has exactly one consistent, nonblank value on every scoped Event. Mixed or partial unit declarations produce a warning and no automatic unit; absent metadata produces no automatic unit. Imported field names remain visible; arbitrary units are never guessed from numeric values or a few examples.

Use **Chart options → Title, labels and units** to name the plot and axes. These labels do not convert measurements or their units. They travel with chart presets, saved views and `.chronoscope` files. Changing a field clears its custom axis label so an old unit does not carry over to a different field. Choosing a different chart type returns its title and axis labels to automatic values. Named saved charts retain their custom labels.

## Missing measurements and busy charts

Charts report the scoped and excluded Event counts. A chart with no usable measurements offers **Show Event counts over time**, preserving the current scope/layer. An empty Selected scope explains how to select Events or choose another scope.

If the plot reaches its mark budget, it clearly states that only some marks are displayed. Time charts offer an explicit coarser interval, such as daily instead of hourly; this never happens silently. Otherwise narrow grouping/filters or change the mark limit in Chart options. Calculations run over the complete scope; the rendering budget does not sample source records. No automatic deletion or outlier filtering occurs.

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
