# SI analytics engine

Chronoscope calculates structured-data answers in Rust and SQLite. SI chooses a capability, submits a validated plan and explains evidence. It does not need to read thousands of Events into its context or calculate their statistics. The same engine is available to the UI, CLI, MCP server and connected SI model services.

## In the app

Ask SI a question such as:

- “Which entities became more active between these two date ranges?”
- “Profile these columns and find duplicates.”
- “Find the median wind speed and its distribution.”
- “Compare each storm's annual maximum wind, rather than weighting storms by their track-position count.”
- “Fit pressure against wind; report the complete-case count and fit diagnostics.”
- “Cluster entity-level measurement summaries, and explain the scaling.”

SI can discover fields with `dataset_schema`/`inspect_dataset`, search `analytics_discover`, request one `analytics_describe` schema, then use `analytics_run`. Apple has small native discover/describe/run tools in addition to its general operation bridge. Those tools use this same Rust engine; they do not add a separate statistical implementation.

A successful run returns a persistent result ID, compact summary and up to five small output rows in findings_preview. This preview is explicitly bounded; full result pages stay in Rust. The chat offers **Open analysis result**. The toolbar's **Results** button also opens saved analyses, including after reopening a project. Inspect findings, counts, warnings, chart previews, paged output and source scope. Click an output row that has an exact Event ID to select it on the map and attribute table; Ctrl/Cmd-click toggles it. Group/preparation rows have no invented Event ID. Stale results disable source-row selection.

Results are included in the portable `.chronoscope` SQLite project, with content checksums. A project with results uses the database format even when small. Exporting such a project to the legacy `.json` format is rejected rather than silently dropping results. **Remove result** frees stored evidence without changing source Events. Saved analyses are derived artifacts, separate from source-record undo history.

## Available operations

| Capability | Calculation | Implementation |
| --- | --- | --- |
| `profile` | Present/missing/finite-numeric/distinct counts, extrema, measurement means/sums/variance | SQLite, average, accurate |
| `group` | 1–4 key counts, numeric summaries, ranked groups/cross-tabs | SQLite |
| `duplicates` | Exact repeated-key groups and counts | SQLite |
| `quantiles` | Exact linear quantiles at p × (n − 1) | Disk-backed SQLite order statistics |
| `histogram` | Equal-width counts; maximum included in last bin | SQLite |
| `outliers` | IQR or population z-score candidate thresholds and exact Event IDs | SQLite, average |
| `correlation` | Pairwise complete Pearson correlations and denominators | average |
| `compare` | Counts/measurement means and changes by group across explicit UTC windows | SQLite |
| `time_series` | UTC minute/hour/day/week/month/year counts/means, lag changes, rolling means | SQLite windows, chrono |
| `one_sample_t` | Two-sided mean test and difference confidence interval | average, accurate, statrs Student-t |
| `welch_t` | Two independent cohort means, unequal variances, confidence interval | average, accurate, statrs Student-t |
| `chi_square` | Contingency independence, expected-cell diagnostics, Cramér's V | SQLite, statrs Chi-squared |
| `regression` | OLS with intercept, coefficients, residuals, in-sample R²/RMSE | linfa-linear |
| `kmeans` | Seeded feature clustering, scaling, centroids, sizes, assignments | linfa-clustering, rand_xoshiro |
| `pca` | Components, embeddings and variance relative to total input variance | linfa-reduction |
| `periodicity` | Regular-bucket, mean-centered FFT spectral candidates | RustFFT |
| `graph` | Explicit directed relationship degrees, weak components, degree ranking | petgraph |
| `trajectories` | Entity track length, elapsed time, segment speed/conflicts | WGS84 GeographicLib |
| `similar_text` | Distinct-value ranking by case-normalized Jaro–Winkler score | strsim |

Existing indexed geographic filters, WKT predicates, distance/proximity/dwell analyses, temporal/spatial aggregation, query projections, selection, and descriptive `statistics` tools remain available. This registry adds reusable analytic families rather than replacing them.

## CLI and MCP

Use `chronoscope call analytics_discover --args '{"search":"compare"}'` for a one-shot query. Use `chronoscope --project study.chronoscope session` for a persistent JSON-lines session. Each line contains `command` and `args`; use one session to run, inspect and save derived results.

Example request to prepare storm/year maxima then calculate their exact median:

```json
{
  "command": "analytics_run",
  "args": {
    "plan": {
      "capability": "quantiles",
      "scope": "all",
      "parameters": { "field": "peak", "probabilities": [0.5] },
      "prepare": {
        "group_by": ["entity", "year_utc"],
        "metrics": [
          { "alias": "peak", "op": "max", "field": "attribute:max_wind_kt" }
        ]
      }
    }
  }
}
```

Preparation supports exact `count`, `sum`, `mean`, `min`, `max` metrics, with 1–4 group keys and up to 16 named metrics. It changes the analysis unit explicitly. This is a bounded group/metric stage, not an arbitrary script, SQL string or general multi-stage join language.

`analytics_result` accepts `result_id`, `section` (`summary`, `details`, `rows`, `chart`, `provenance`), `offset`, `limit` (up to 200), and optional `summary_fields`. `analytics_list` finds saved handles; `analytics_remove` deletes one. The MCP names are prefixed `chronoscope_`. `analytics_run` is also accepted by `job_start` for polling, progress and cancellation. Use `expected_revision` to reject a changed source before starting. Tool schemas come from the Rust registry and generated frontend contracts.

`scope` is `all`, `visible` (default) or `selected`. Explicit filters and optional source narrow that scope. Selected scope intersects the active filter and frozen selection. Source fields use `attribute:ORIGINAL_NAME`; IDs stay decimal strings. `time_utc` and `year_utc` are available as derived keys. Count-like identifiers are not automatically treated as measurements. Units are not inferred from successful number parsing.

## Execution, correctness and limits

- One expensive analysis runs at a time per engine. It pins an independent WAL read view under a brief gate, then releases workspace locks before staging/querying/fitting. Views and edits can proceed. A project replacement causes result attachment to fail; an ordinary data edit leaves the captured result visibly stale.
- The cache binds the data generation, plan, filter, source and selection. Source changes invalidate reuse. Artifacts retain parameters/preparation, algorithm version, source revision, evaluated/excluded counts, assumptions and exact source IDs where defined. Derived artifact writes mark the workspace dirty but never change Event values.
- There is **no implicit sampling**. SQL/streaming methods process the full scope subject to finite disk/time limits. Matrix methods reject scopes above **200,000 input rows or 4,000,000 numeric cells**, even if some rows would later be excluded. Explicit grouping or filters can reduce inputs before fitting.
- Temporary SQLite storage is file-backed with a 256 MiB page budget and bounded page caches. Graphs allow at most 200,000 distinct directed edges/50,000 nodes; similarity allows 100,000 distinct strings of at most 4,096 bytes; FFT allows at most 262,144 regular buckets. K-means additionally bounds iteration work. Resource failures are explicit, without an approximate answer.
- Each run has a **cooperative five-minute deadline**, including worker waits. SQL and row loops check cancellation. Numerical library kernels can only be interrupted before/after the kernel; this is not a hard process-level deadline. SI's own shorter request deadline can also apply.
- Output retention defaults to 10,000 rows, configurable to 100,000. Calculations still evaluate full inputs. `total_rows`, `retained_rows` and `limited` distinguish truncated output from sampled input. At most 32 results/256 MiB total, 32 MiB per artifact, are stored in a project. Remove unneeded results when full. Result pages are capped at 1 MiB. Compact summaries above 1,800 serialized characters expose named sections instead of flooding model context.
- Missing/non-finite measurements are excluded explicitly. Constant/insufficient/unsupported numerical ranges are reported rather than converted into fictitious zero results. Input/retained/evaluated counts can have different units after preparation. Profiles distinguish null absence from present text; blank strings are present, not null.
- Inferential tests assume independent observations. Repeated entities, spatial/temporal dependence, biased samples and multiple testing need a suitable analysis design. Warnings do not establish significance or causality. Regression diagnostics are in-sample, without held-out accuracy claims. No trained-model deployment format is promised.
- Feature K-means rejects canonical or obviously named longitude/latitude columns. It is not a geodesic spatial clustering tool. Coordinate aliases cannot establish units automatically; use existing metric spatial analyses for geographic proximity.
- Time comparison windows are UTC fractional-second **[start, end)**. Rolling windows cover observed calendar buckets; missing buckets are not silently filled. FFT requires explicit zero-fill when buckets are missing. Its peaks are candidates, not a significance test.
- Trajectories use consecutive located Event anchors, disclose same-time conflicts and span missing-location gaps. Polygon-centroid anchors remain derived point locations; track distance is not polygon perimeter.

Chart previews currently cover the displayed result page, with explicit labels. Group selection and thematic map/track recoloring are not automatically inferred from a statistical output. Arbitrary joins, unrestricted transformations, survival/causal models, model export and additional specialist methods remain future capabilities; the registry advertises only methods that execute today.

## Verification

`cargo test --test analytics_engine` covers all nineteen operations with known-answer fixtures, exact large IDs, save/reopen, stale results, selection/filter semantics, validation, isolation from concurrent edits and a 200,001-Event full-scope/budget fixture. `tests/assistant_aggregation.rs` exercises real SI discovery/describe/run through a mocked service and the actual Rust executor. The mock tests orchestration, not an LLM's reasoning quality.

`scripts/test_analytics_engine.py` uses NumPy/SciPy/scikit-learn as independent QA oracles against the bundled public Atlantic hurricane data and actual CLI/MCP. They are optional development dependencies, not application runtimes. `frontend/scripts/analytics-qa.mjs` exercises the real Rust service and browser Results UI offline. Apple Intelligence is retired as an SI Chat provider; its historical model tests are archived as earlier-version evidence.


Canonical Event clocks retain seconds and fractions as binary64 UTC Unix seconds. Trajectory elapsed times and speed calculations use stable duration subtraction; encounter/dwell/gap thresholds can be fractional seconds. Comparison boundaries need not align to minutes. Calendar series offer second buckets, Charts offers millisecond/second/minute intervals, and FFT permits explicit fractional-second widths. Finer output does not improve the original source's measurement precision; inspect timestamp granularity and gaps before interpreting high-frequency results. See the temporal precision section in ARCHITECTURE.md for numeric limits and old-workspace migration.
