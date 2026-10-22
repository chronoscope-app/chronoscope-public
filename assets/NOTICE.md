The offline geography is derived from Natural Earth vector data, in the public domain.

- Source: https://github.com/nvkelso/natural-earth-vector
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- Layer: Natural Earth 10m coastline, simplified with a 0.005-degree tolerance and rounded to five decimal places by `scripts/prepare_geography.py`.
- This layer is a geographic reference, not surveyed street geometry.

Bundled demonstration data includes explicitly labelled synthetic studies and public-data samples. See samples/public/SOURCES.md and docs/NOAA-HURRICANE-DEMO.md for provenance.

The offline globe reference map is derived from public-domain Natural Earth II shaded-relief artwork. [Exact source, SHA-256, terms and generator](provenance/NATURAL-EARTH.md). It contains no satellite imagery or terrain heights.

The outbound MCP client uses the official Model Context Protocol Rust SDK,
`rmcp` 3.5.1 (Apache-2.0): https://github.com/modelcontextprotocol/rust-sdk .
Its bounded HTTP SSE adapter uses `sse-stream` (MIT OR Apache-2.0):
https://crates.io/crates/sse-stream . Cargo.lock records exact dependency versions;
upstream sources include their respective license texts.

Streaming descriptive statistics use `average` 0.17.0 (MIT OR Apache-2.0),
https://github.com/vks/average . Compensated numerical sums use `accurate` 0.4.1
(MIT OR Apache-2.0), https://github.com/bsteinb/accurate . Cargo.lock pins these
libraries and their transitive dependencies. Their MIT license texts are bundled
in [average's license](licenses/average-LICENSE-MIT.txt) and
[accurate's license](licenses/accurate-LICENSE-MIT.txt). These are native Rust calculations, shared by the
UI and agent tools, without a Python runtime or BLAS dependency.

The Cesium prototype uses CesiumJS 1.146.0 (Apache-2.0), with bundled runtime
workers/assets and upstream notices: https://github.com/CesiumGS/cesium .
The library license is reproduced in [licenses/cesium-LICENSE.md](licenses/cesium-LICENSE.md).
The local EGM96 geoid grid has separate [provenance and limits](../frontend/src/assets/egm96-15-NOTICE.txt).
The build makes one guarded compatibility change to Cesium's bundled Knockout 3.5.1 (MIT): its global-object lookup uses `globalThis` instead of `eval`. The upstream license remains intact; `frontend/vite.config.ts` applies and validates the change in production and development builds.

Display track interpolation uses GeographicLib Geodesic 2.2.0 (MIT/X11), the Karney WGS84 geodesic implementation: https://github.com/geographiclib/geographiclib-js . Its license is in licenses/geographiclib-geodesic-LICENSE.txt. Analytical distances remain in the shared Rust engine.

Renderer test imagery and terrain are first-party generated synthetic fixtures, licensed MIT. They are diagnostic patterns and fictional heights, not geographic observations. See [imagery](../tests/fixtures/cesium/README.md) and [terrain](../tests/fixtures/terrain/SOURCES.md).

Structured-data analytics additionally incorporates statrs 0.19.1, Linfa and its linear/clustering/reduction crates 0.8.1, ndarray 0.16.1, RustFFT 6.4.1, petgraph 0.8.3, strsim 0.11.1, rand 0.8.6 and rand_xoshiro 0.6.0. Upstream license texts are reproduced in assets/licenses with each crate name. Cargo.lock pins all dependencies; see docs/STATISTICS-CRATES.md for roles and correctness adapters. No native BLAS or Python runtime is required.

Rich SI chat uses Marked 18.1.1 (MIT), DOMPurify 3.4.17 (MPL-2.0 OR Apache-2.0), KaTeX 0.19.0 (MIT), Apache ECharts 6.1.0 (Apache-2.0, with its NOTICE and incorporated d3 notice), and zrender (BSD-3-Clause). Native source links use tauri-plugin-opener 2.7.2 (MIT OR Apache-2.0). Their upstream licenses/notices are bundled in assets/licenses and copied into the app. Formatting/chart modules load on demand; chat captures and rich artifacts remain session-scoped Rust data.
