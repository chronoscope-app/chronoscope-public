# Numerical library choices

The Rust engine owns record scope, schema validation, missing-data policy, cancellation, deterministic traversal and compact result contracts. Established libraries own the numerical accumulators. This replaces the custom Welford/Kahan/covariance recurrences introduced with Apple SI tools.

## Incorporated

| Library | Role | Configuration |
| --- | --- | --- |
| [average 0.17.0](https://crates.io/crates/average) | Streaming variance, covariance, Pearson correlation and extrema | Exact direct version; defaults off; `std` only |
| [accurate 0.4.1](https://crates.io/crates/accurate) | Neumaier compensated sum; primary mean derives from compensated sum/count | Exact direct version; defaults off, including its optional Rayon integration |

Both publish under MIT OR Apache-2.0. Sources inspected: [average](https://github.com/vks/average) and [accurate](https://github.com/bsteinb/accurate). On 2026-10-17, crates.io reported roughly 9 million cumulative downloads for average and 0.8 million for accurate; downloads indicate adoption, not proof of correctness. average declares Rust 1.85, below Chronoscope's existing 1.89 minimum. Cargo.lock pins transitive dependencies. The small dependency set uses Rust implementations and needs no Python, BLAS, GPU, data-frame conversion or hardware-specific numerical backend.

`statistics` and the UI dataset summary share `SummaryAccumulator`, a policy adapter around these crates. The legacy in-memory statistics helper also delegates variance and compensated sums to them. SQL still owns indexed filtering, grouping and exact median rank selection. Sorting/median lookup is not replaced by an approximate quantile sketch. Adding a crate does not automatically expose every one of its methods as an agent tool.

Input rows stream through one stable pass without collecting the full dataset in memory. The adapter excludes missing/non-numeric values and preserves paired denominators. It maps undefined library results to explicit null/undefined output and rejects unsupported non-finite results rather than allowing JSON serialization to conceal them. Reported primary means use the compensated sum: this retains the residual in `1e16 + 1 - 1e16`, where a plain running sum/mean can lose it.

### Pearson range policy

average's `Covariance::pearson` computes a square root of the product of two unnormalised moment sums. For sufficiently large or tiny finite fields, that intermediate product overflows/underflows; overflow can yield an incorrect finite zero correlation. Before calling it, Chronoscope checks that product's range. Unsupported cases return `RESOURCE_LIMIT` with a rescaling instruction. Constant fields and insufficient paired counts retain their distinct undefined results. Small rounding excursions within 1e-10 of [-1,1] are clamped; larger violations fail.

This is a boundary guard around the library function, not a second correlation implementation. Known-answer tests include perfect positive/negative correlation, missing pairs, constant/empty input, cancellation-resistant sums, a 25,000-row population and scale limits. `scripts/test_analytics.py` independently compares the bundled hurricane data against Python's standard-library arithmetic and verifies actual CLI/MCP results; Python is a test oracle only.

## Broader libraries now incorporated

The [analytics engine](ANALYTICS-ENGINE.md) additionally incorporates statrs 0.19.1, Linfa/linfa-linear/linfa-clustering/linfa-reduction 0.8.1, ndarray 0.16.1, RustFFT 6.4.1, petgraph 0.8.3 and strsim 0.11.1, with rand 0.8.5/rand_xoshiro 0.6.0 for reproducibility. Defaults/native BLAS are disabled where appropriate. These are exercised methods, not dormant dependencies. Tests independently compare inference/OLS/PCA to SciPy/scikit-learn. The PCA adapter uses Linfa singular values with the sample-count variance denominator because its convenience variance helper uses component count; tests cover full and reduced dimensions. Graph metrics use petgraph structure/components/degrees, without its quadratic PageRank kernel. Upstream license files are in assets/licenses.

## Other established candidates

| Library | Appropriate use | Current decision |
| --- | --- | --- |
| [statrs](https://github.com/statrs-dev/statrs) | Probability distributions, special functions, hypothesis-testing building blocks and additional statistics | Incorporated 0.19.1 for Student-t confidence/testing and Chi-squared inference. |
| [ndarray-stats](https://github.com/rust-ndarray/ndarray-stats) | Statistics over numerical n-dimensional arrays | Appropriate for future matrix/raster analyses; current records already reside in indexed SQLite. |
| [nalgebra](https://nalgebra.rs/) | Linear algebra, decompositions and regression foundations | Add with a concrete matrix-analysis capability rather than duplicating algorithms. |
| [Polars](https://pola.rs/) | Broader columnar data-frame transformations and analytics | Consider if workflows need its execution model. Adding a second storage/execution engine solely for variance/correlation would not help this streaming path. |

Future methods should add typed, bounded Rust operations backed by suitable crates, with clear assumptions and method-specific tests. Specialist Python/MCP services remain optional; standard arithmetic does not require them.

See [the broader analytics architecture](ANALYTICS-ARCHITECTURE.md) for the user-question domains, small discovery/run/result interface and execution model and further directions for hundreds of thousands of records.
