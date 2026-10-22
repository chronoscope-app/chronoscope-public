# Apple Intelligence with workspace tools

Apple Intelligence chooses operations and explains evidence. The schema-aware Rust engine reads Events, applies filters and calculates results. The model does not calculate statistics from thousands of rows, and rendering clusters or point budgets do not limit analytic input.

## Available operations

`inspect_fields` answers field-content questions through the shared read-only `field_profile` engine command. It supports canonical fields, derived UTC dates, collections and imported columns. No field-specific answer or example is hardcoded. Schema discovery supplies names, not evidence of missing data. The native tool reads one field per call to keep Apple's generated arguments simple; CLI/MCP can batch up to four.

Profiles contain exact present, null, empty-string, empty-collection, non-empty, distinct and finite-numeric counts over the complete requested scope. Bounded distinct examples carry real Event IDs. Imported display names resolve to `attribute:<name>` when unambiguous; explicit names resolve collisions. Unknown/ambiguous fields fail rather than becoming empty columns. Numeric parsing does not infer units or turn identifiers into measurements.

Choose `all`, `visible` (default), or `selected`; selected intersects current filters. Optional `source` restricts a layer, and `expected_revision` rejects stale requests. A pinned database reader keeps counts and examples at one revision. Scans run after releasing the UI workspace lock, share the bounded analytic worker, use disk-backed temporary storage, and support job cancellation. Inspection does not create saved analysis artifacts or modify records.

Only examples are bounded. Long values and examples removed for Apple's context budget are explicitly marked as omitted; exact counts remain. Chat displays engine-backed evidence beside the explanation. The model can still misinterpret results: inspect those counts, scope and examples when evaluating its answer.

The native Foundation Models session registers `inspect_dataset`, `inspect_fields`, `query_events`, `summarize_events`, `numeric_statistics`, `tool_catalog`, `tool_schema` and `perform_operation`. The last three discover and execute the wider shared CLI/MCP tool set on demand. This includes projected record queries and cursors, source/attribute/geographic/time filters, selection, views, existing spatial/temporal analyses, and permissioned record changes. It is a general tool bridge, not a date-extraction classifier.

`dataset_schema` lists canonical and original fields. Optional `include_attribute_types:true` returns exact present/numeric counts for the requested attribute page, distinguishing numeric, text and mixed fields across the entire dataset. Numeric attributes are finite Rust `f64` parses of their original strings; units and date semantics are not inferred from column names. Use `attribute:<exact name>` for original fields. Search and paginate wide schemas.

`statistics` returns count, excluded missing/non-numeric count (`missing`), min/max, compensated sum, mean, population variance, population and sample standard deviation. An optional `other_field` adds pairwise Pearson correlation, paired count and missing-pair count. Constant fields, empty input and fewer than two pairs produce explicit null/undefined statistics. No values are imputed. A second field only changes paired calculations; the primary summary still includes all finite primary values.

These calculations stream over every matching row in stable internal row order: O(n) time and constant working memory. Maintained Rust libraries provide the numerical accumulators: **average 0.17.0** for variance, covariance, Pearson correlation and extrema; **accurate 0.4.1** for Neumaier compensated sums. The reported primary mean uses the compensated sum divided by the valid count. Live dataset summaries share this backend; the legacy statistics helper also uses these libraries. Existing exact median lookup stays in SQLite's indexed ordering. See [dependency selection](STATISTICS-CRATES.md).

Results include `evaluated_count`, `sampled:false`, workspace revision and a compact scope fingerprint, source and selection flag. Decimal arithmetic is not provided: floating-point rounding applies, and unsupported numeric magnitudes fail explicitly with a rescaling suggestion. The Pearson adapter checks intermediate overflow/underflow rather than accepting a misleading finite zero from an out-of-range denominator. “Exact” means full matching input, not sampling or exact real-number arithmetic. Correlation measures linear association, not causation. Latitude/longitude correlation is numeric coordinate correlation, not a geodesic relationship or a valid substitute for spatial statistics.

`aggregate` calculates grouped counts and numeric summaries, including UTC years. Check `limited` before treating returned groups as exhaustive. `time_utc` and `year_utc` are read-only query projections; `time_parse` converts dates into UTC epoch filter boundaries with the existing ambiguity rules and fractional-second precision. Stored timestamps, coordinates and original attributes remain unchanged.

The new commands are available through CLI/MCP and hosted SI too:

```sh
chronoscope --attach call dataset_schema --args '{"include_attribute_types":true,"attribute_limit":8}'
chronoscope --attach call statistics --args '{"field":"value","other_field":"attribute:Wind","apply_filter":false}'
chronoscope --attach call aggregate --args '{"group_by":"year","selected_only":true}'
chronoscope --attach call time_parse --args '{"value":"2024-01-01T00:00:00Z"}'
```

Replace example field names with names discovered in your project. By default statistics and aggregates respect current filters. `apply_filter:false` ignores those filters; `selected_only:true` further restricts the requested scope. Explicit `filter` and `source` inputs use the same validated indexed query engine. `statistics` supports background `job_start` execution, progress and cancellation.

Existing `analysis_context`, `analysis_prepare` and `analysis_execute` provide eligibility, revision-bound plans and results for proximity, stationary periods, gaps, speed and clustering. Their input/output budgets and `limited` flags still apply; these are distinct from the full-scope streaming statistics above.

## Permissions and transport

Workspace queries, analysis, selection and presentation require no folder grant. Record edits/deletion require **Allow record changes for the next message**. The grant resets after sending. Apple SI does not receive arbitrary file access, shell execution, API keys or permission to configure services.

Tools configured and explicitly granted through **SI settings → Tools** can be discovered too. External actions additionally require the per-message external-action permission. Grants, tool-schema fingerprints and connection identity are checked at execution. External tools may transmit requested data to their services; on-device inference does not make those services local. Their effects are outside Chronoscope Undo.

Swift communicates with Rust through private anonymous stdin/stdout pipes, not a listening port or a file-based RPC service. Requests execute on the original Rust caller thread, preserving operation cancellation and scope. IDs bind replies to calls; repeated IDs, excessive frames and malformed requests are rejected. There are at most 32 calls and a five-minute deadline. The worker is killed on cancellation/failure. Completed actions remain, and failure messages include the tool log when available.

Results delivered to Apple's small context are bounded: up to 25 queried rows, paged schema/catalog discovery and at most 4 KiB per result. Oversized results are explicitly omitted, without a misleading cursor that skips unseen rows; ask for fewer columns/rows or a deterministic summary. Large tool schemas can also exceed this limit; simplify external schemas where needed. The model can still choose poorly or misinterpret results; successful tool evidence, scope, missing counts and limitation flags should substantiate its explanation.

The SDK registers real tools and counts their definitions toward its model context. Old conversation turns and optional summary context can be omitted to fit; the current message is never excerpted. Context exhaustion after a tool stops inference rather than replaying a potentially completed mutation. There is no cloud-model fallback.

## Mac verification

Build from source with the Xcode/Foundation Models requirements in [the Mac handoff](MAC_HANDOFF.md), then:

```sh
cargo build --locked -p chronoscope --bin chronoscope
node scripts/generate_contracts.mjs --check
npm --prefix frontend run build
npm --prefix frontend run test:apple-local
npm --prefix frontend run test:apple-fields
```

The opt-in test uses the actual Mac model, checks query/aggregate/statistics tool evidence, selects an entity through discovery, and verifies an allowed tag edit. It also covers ordinary chat, follow-ups and cancellation. It is not an inference mock and requires Apple Intelligence to be ready. Linux tests cover the private-pipe protocol using fixture subprocesses, actual Rust queries, permission enforcement, schemas and known statistical answers; they cannot compile or run Foundation Models.

`test:apple-fields` separately checks natural field questions against actual engine evidence: text, imported numeric text, numbers, dates, empty strings, collections, hidden/selected scopes, omitted long values and ordinary free-form chat. It uses an isolated local test profile and the real on-device model. Model wording can vary; inspect the saved answers alongside the exact tool results.

Try in SI chat:

- “Inspect the fields and show two Events with their original IDs, UTC times and wind values.”
- “Count all Events by UTC year. Use the entire project, ignoring display filters.”
- “For the selected Events, calculate mean, standard deviation and missing values for Wind. Use Rust statistics.”
- “Calculate the Pearson correlation between the two numeric fields I choose. Explain the pair count and limitations.”
- “Select all Events belonging to this entity, then show their track gaps longer than six hours.”
- After enabling record changes: “Add the tag Reviewed to the selected Events.”

## Further statistical packages

The first choice for routine exact analytics is a typed Rust operation with a shared schema and compact result. There is no Python dependency in this implementation. For future regression, hypothesis testing or specialist geostatistics, an optional, explicitly configured specialist MCP service can use SciPy, statsmodels or scikit-learn. Give that service bounded data access and explicit method parameters; return diagnostics and provenance. Arbitrary model-generated Python in the app process is not part of this design.

Structured-data analysis now includes nineteen discoverable Rust/SQLite capabilities, persistent results, group/metric preparation and linked result tables. SI chooses methods; Rust computes full scoped data. See [analytics engine, examples and limits](ANALYTICS-ENGINE.md). Use **Results** to inspect or remove saved analyses. They are preserved in `.chronoscope` projects.

The native bridge also discovers `present_result` for inline result charts/tables and map snapshots. Formatting and image bytes stay outside model inference. The conversation can move between docked and detached chat while its Rust worker continues. See [rich SI chat](SI-RICH-CHAT.md).
