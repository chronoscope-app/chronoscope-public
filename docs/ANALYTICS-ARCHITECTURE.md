# A data engine for SI-driven analysis

Design direction following the user's structured-data workflow, 2026-10-17. The registry, snapshot execution, persistent results and nineteen analytic families are now implemented: see [delivered engine, examples and exact limits](ANALYTICS-ENGINE.md). The discussion below includes future extensions (general joins/derivations, specialist methods, trained-model export and automatic map overlays); those are not claims of delivered functionality. Dependency choices are in [statistics crates](STATISTICS-CRATES.md).

## User workflow

A user opens a project containing hundreds of thousands of Events and asks an ordinary question. SI identifies the question, discovers a relevant capability and submits typed parameters. Rust queries the entire requested population, executes the calculation, stores the result and returns a small evidence summary. SI explains the evidence and can request a chart, map overlay, table or a few source rows. Model context size does not bound how much data the engine can analyze.

For “Which entities became more active this year?”, the engine should group full-dataset Events by entity/time period, compute the baseline/comparison and changes, rank results and return denominators plus a compact findings table. SI should not page every Event or calculate percentage changes itself. For “Are storms becoming stronger?”, the analytic unit must also be explicit: a storm's maximum wind and every individual track-position wind measurement answer different questions. Units, scope and assumptions are part of the operation contract.

## Capability domains

| User question | Engine capability | Rust/library foundation |
| --- | --- | --- |
| What columns are here; which values are missing or duplicated? | Schema, profiles, missingness, exact distinct/duplicate groups, value frequencies | SQLite indexes/grouping and existing Rust schema/type validation |
| Who/what appears most often; compare these groups | Group-by, ranking, cross-tabs, pivots, cohort comparisons | SQLite execution; library-backed numeric summaries |
| What is typical, unusual or related? | Quantiles, distributions, robust outliers, correlation, confidence intervals, appropriate statistical tests | average/accurate; statrs for inference building blocks |
| What changes through time? | Calendar buckets, gaps, rolling windows, growth rates, trend/change candidates, regular-sampled periodicity | SQLite windows, chrono, streaming accumulators; RustFFT for spectral methods |
| Which records/entities behave alike? | Feature preparation, scaling, clustering, PCA, regression | Linfa's selected algorithm crates; ndarray/nalgebra where needed |
| What happens near this place or along these tracks? | Geographic predicates, distances, dwell/proximity, spatial/temporal grouping, trajectory features | Existing GeoRust, GeographicLib and SQLite R-tree; validated metric/projection adapters |
| Which entities are connected? | Relationship graphs, components, paths and selected graph metrics | petgraph with explicit domain definitions of nodes/edges/time windows |
| Which text values are equivalent or similar? | Exact/tokenized search, normalized values, candidate duplicate matching | Existing SQLite FTS and regex; a targeted similarity crate when the matching capability is exposed |

Candidate primary documentation: [statrs](https://github.com/statrs-dev/statrs), [Linfa's algorithms](https://rust-ml.github.io/linfa/), [nalgebra](https://nalgebra.rs/), [RustFFT](https://github.com/ejmahler/RustFFT), [petgraph](https://github.com/petgraph/petgraph), and [GeoRust](https://georust.org/). Linfa includes K-means/DBSCAN, linear models and PCA; integrating those implementations still requires feature/scope/scale and result adapters. A crate supplies algorithms, not the app's complete user workflow.

## Small tool interface, broad discovery

The current `tool_catalog`/`tool_schema`/`perform_operation` bridge already avoids including every tool definition in each Apple prompt. Extend this with a domain-oriented analytic registry and a few operations (names below are proposed):

1. **Discover:** search capabilities by intent, available columns, semantic types and scope. Return short eligible choices, required inputs, exact/approximate behavior, cost class and a capability ID.
2. **Describe:** retrieve only the chosen capability's validated input schema, assumptions, supported units/missing-value policy and output sections. Advertise actual implemented operations; unavailable backends stay unavailable.
3. **Run:** submit a declarative analysis plan or bounded multi-step pipeline. Validate the complete plan before starting a job; compile data access into parameterized SQL/approved kernels. This is not arbitrary SQL, scripts or model-generated code.
4. **Inspect results:** return a compact summary or fetch one named section, chart, findings page or bounded record projection by result ID. Heavy intermediate tables and feature matrices remain in the engine.

The model can then say “compare annual storm maxima by basin” in one structured request rather than performing a long sequence of raw-record reads and arithmetic. Broad operations such as group/derive/window/join let the engine compose supported calculations. Derived columns and result tables should remain separate from source Events until the user explicitly applies a change.

Each registry entry needs an algorithm/version, parameter schema, eligible field types and units, input/output contracts, execution strategy, memory/time limits, determinism/seed policy, missing-data rules, approximation semantics, cancellation points and an independent verification fixture. Field discovery needs semantic distinctions such as ID versus numeric measurement, instant versus duration and coordinates versus arbitrary numeric features; successful numeric parsing alone does not establish meaning.

## Execution and storage

- Keep SQLite authoritative for source Events, exact indexed filters and existing portable projects. Push projection, predicates, grouping and joins down to the database.
- Stream statistics and other streamable operations in bounded batches. Materialize only necessary columns for algorithms that require a matrix. A streaming accumulator cannot make every clustering/model algorithm constant-memory.
- Preflight batch algorithms against the selected scope and memory budget. Offer documented aggregation, a suitable incremental algorithm or explicit sampling when necessary. Never silently downsample; disclose evaluated/input counts and approximation. Geospatial display LOD is independent of analytic scope.
- Execute longer work in cancellable background jobs, with progress and an immutable revision-bound read view. Extend the current engine's read-connection/snapshot model so a lengthy model fit does not hold the UI's workspace mutex. Bound retained snapshots, temporary storage and job lifetime.
- Persist result metadata and large artifacts in an engine-managed result store with typed handles, content hashes, expiry/pinning and project ownership. Current job handles are session-only; durable/reopenable analysis artifacts are additional work.
- Cache using dataset revision, scope, selected IDs/revision where relevant, parameters and algorithm version. Source changes invalidate dependent results; stale results remain visibly identifiable.
- Results should support linked tables, plots and map/track overlays, with exact source IDs for drill-down and selection. Trained models additionally need feature order, transformations, training scope, random seeds, diagnostics and reproducible serialization.

A compact result envelope should identify the analysis and workspace revision, scope, input/evaluated/excluded counts, method/version, parameters, assumptions, whether sampling occurred, key findings and artifact handles. SI receives the small envelope and requested sections, while the user can inspect complete engine results.

## Domain correctness

Statistical tests need an analysis design, not just a distribution function: independence, repeated entities, temporal/spatial autocorrelation, missingness and multiple comparisons can change interpretation. Report effect sizes and uncertainty where appropriate, and make unsupported assumptions explicit. User-selected measurements and units should drive method eligibility.

Spatial clustering must use validated geodesic distances or a suitable explicit projection; Euclidean distance between raw longitude/latitude degrees is not a generic metre-based metric. Polygon centroids remain derived anchors, not replacements for source geometry in shape analyses. A proximity edge describes the specified spatial/time rule and does not establish an actual interaction.

## Delivery sequence

1. **Foundation:** keep shared schema-aware statistics, permissions, jobs and bounded discovery; introduce the domain registry and consistent result handles.
2. **High-frequency structured-data questions:** profiles/quality, flexible grouping/ranking/cohorts, exact quantiles, rolling/window comparisons, correlations and outliers. Build these over SQLite and the statistical libraries, and connect results to tables/charts/selections.
3. **Broader analytic families:** statrs-backed inferential methods, Linfa-backed regression/clustering/PCA, and richer geospatial/trajectory/graph capabilities. Include the relevant Rust crates as working capabilities with tested adapters.
4. **Specialist extensions:** periodicity, domain-specific models and optional explicitly granted external MCP analytics. A separate data-frame engine such as Polars should be evaluated against real transformation workloads, memory needs and duplication with SQLite.

This direction intentionally keeps the SI model's job small while giving it a broad, discoverable and composable analytic toolbox. Existing crate-backed primitives are the first layer; the registry, richer operations and durable results are the next product work.
