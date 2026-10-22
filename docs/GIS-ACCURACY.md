# GIS accuracy and coordinate contract

The audit found real defects and corrected them. This is a documented WGS84 implementation with independent numerical regression tests; it is not a claim that every CRS, datum or source measurement is supported or survey accurate.

## Current Cesium renderer

The Rust coordinate, import, WKT, geodesic-analysis and source-elevation contracts remain in force. Cesium supplies native WGS84 ellipsoid positions for Globe and a WGS84 geographic projection for 2D/Columbus views. Polar event coordinates remain intact in those views; the WMTS compositor separately limits raster coverage to approximately ±85.0511° because its intermediate image uses Web Mercator. Time becomes a display-height offset in space-time, never a stored geographic altitude.

The inherited Rust DTED mesh snapshot also uses Web Mercator and is limited to approximately ±85.0511°. The frontend clips its sampling halo to that domain. Polar DTED files can be indexed and queried for source elevations, but their terrain surface outside that band is unavailable in this prototype. This limit does not clamp event or WKT coordinates, which retain the full geographic latitude range.

Terrain requires an explicit vertical-datum choice. For a source confirmed to use **EGM96 orthometric heights**, the bundled NGA 15-minute geoid grid supplies undulation `N`, and display height is `h = H × vertical_exaggeration + N`. At 1× this is the usual `h = H + N` conversion to WGS84 ellipsoid height. Geoid undulation is not exaggerated. An explicit ellipsoid-height interpretation applies no geoid addition; generic unresolved MSL is not displayed. Selecting a model is a user interpretation of source metadata, not automatic datum detection. `terrain_sample`, exported values and embedded original DTED keep source `H` unchanged.

The grid's centimetre storage has at most 0.005 m encoding error; that is **not** the accuracy of the 15-minute geoid model, its interpolation or the source terrain. This display conversion does not establish survey or engineering accuracy. [Grid provenance](../frontend/src/assets/egm96-15-NOTICE.txt), [native resource tests](../frontend/scripts/cesium-resource-test.mjs) and [current prototype validation](validation/cesium-prototype-2026-10-15) distinguish numerical checks from rendered-terrain checks. A native terrain provider existing is not proof that its displayed surface height was correct; actual surface comparisons require passing runtime evidence.

The original 0.5.1 audit and captures below explain retained backend fixes and earlier validation. Three.js camera/mesh assertions and those images describe the original renderer, not Cesium certification. Current native-renderer checks are listed in [the parity inventory](CESIUM-PARITY.md).

## Original 0.5.1 audit corrections

- Replaced `geoconvert` 1.0.2 with pinned, pure-Rust `mgrs-convert` 0.1.0. The old MGRS formatter can panic for equatorial/low northern-latitude coordinates because its northing/hemisphere logic is wrong. The replacement passes the independent tests below. Negative zero is northern at the equator; +180° longitude normalises to −180°, the same meridian. Converter faults are returned as errors rather than unwinding a CLI session.
- Coordinate responses now explicitly identify the output `grid_system` and `grid_crs`. The legacy `utm` object uses zone 0 for UPS; it is not a UTM zone. Explicit UTM input still requires zone 1–60 and a separate N/S hemisphere. Inverse-projection domain edges tolerate at most 1e−10 degree of numerical excess (about 11 micrometres); this fixes an exact 80°S boundary rejection observed in native Apple Silicon CI without relaxing coordinate agreement tests.
- Proximity, stationary and speed use WGS84 **ellipsoidal geodesics**, replacing a mean-radius spherical approximation. Candidate buckets use WGS84 ECEF, whose straight chord cannot exceed the shortest surface geodesic, so the acceleration structure cannot discard an in-radius pair for spherical/ellipsoidal disagreement.
- Flat Web Mercator omits events beyond its latitude limit instead of clamping them to false locations. A visible notice directs users to Globe/table; original coordinates and exact selection remain intact. Flat trails split at the antimeridian instead of drawing a false cross-world segment. Globe retains polar events at their actual latitude.
- Flat terrain vertical scaling includes the local Web Mercator secant-latitude scale. Marker/stem bases interpolate the **actual displayed triangles**, including transformed vertex heights, rather than taking the nearest terrain post. Tiny floating-point errors at mesh edges are tolerated; no-data cells are not treated as elevations.
- DTED requires explicit WGS84 horizontal and MSL vertical datum declarations, correct longitude/latitude hemispheres, sequential records and zero partial latitude offsets. Unknown datums are rejected. The bilinear source sampler does not manufacture heights through positive-weight void posts. Existing checksum checks remain.
- WMTS recognises exact supported CRS identifiers, distinguishes EPSG:4326 latitude/longitude from OGC CRS84 longitude/latitude, and rejects look-alike identifiers. Matrix dimensions must be integers. Unsupported projections are rejected; they are not relabelled as Mercator.
- The scene labels vertical exaggeration and imagery time. The extent annotation explicitly says **projected kilometres**, so it is not mistaken for ellipsoidal ground distance.

## Independent reference tests from the original audit

[Reference fixture](../tests/fixtures/gis-reference.json) is generated by [this script](../scripts/generate_gis_reference.py), which does not import app projection code. Expected values come from PROJ 9.8.1 / pyproj 3.8.0, GDAL 3.12.2 / rasterio and the GEOTRANS-backed Python `mgrs` library. These are development/reference dependencies, not runtime requirements.

| Check | Coverage and numerical tolerance |
|---|---|
| WGS84 DD → UTM/UPS and reverse | 833 vectors: all 60 zones, both hemispheres, equator/signed zero, Norway/Svalbard, dateline, polar caps and seeded random points; easting/northing within 1 mm of PROJ; reverse within 1e−8 degree |
| MGRS | All 0–5 digit-pair precisions (100 km to 1 m), six regions including UPS, spaced/unspaced input; 36 cells and their independent centres; within 1e−8 degree |
| EPSG:3857 | Rust and actual browser coordinates compared with PROJ; 1e−7 metre arithmetic tolerance in the supported latitude domain |
| WGS84 ECEF globe | Actual browser double-precision coordinates compared with PROJ EPSG:4978, accounting for Three.js axis layout; 2e−7 metre arithmetic tolerance |
| DTED registration/interpolation | 205 GDAL-decoded post/interpolation samples, including corners and edges; 0.002 metre tolerance; no half-pixel displacement |
| Ellipsoidal distances | 106 PROJ geodesics, including antipodes/dateline/poles; 1e−5 metre arithmetic tolerance |
| Terrain rendering | Browser checks marker bases against the actual Float32 mesh triangles, Mercator metre scaling, voids, polar omission and Globe retention |
| WMTS | Exact CRS recognition, EPSG:4326/CRS84 axis order, nonnumeric matrix identifiers, declared origins/scales and layer limits |

Numerical agreement is **not real-world data accuracy**. The reference code and app share published mathematical definitions; their agreement cannot establish the correctness of a source survey, the source datum or the camera's Float32/pixel precision. GEOTRANS and GeographicLib also differ in the standard UTM/UPS switch at exactly 84°N and can choose adjacent MGRS cells at exact metre boundaries. Those boundary conventions are explicit in the fixture generator; the test does not hide arbitrary geographic disagreement.

Tests:

```sh
cargo test --locked -p chronoscope
npm run build
npm --prefix frontend test
# Optional independent fixture regeneration:
python -m pip install pyproj mgrs rasterio
python scripts/generate_gis_reference.py
```

Current browser tests make no public map requests. The four-tile historical capture was opt-in. The frontend unit tests include native-provider/geoid numerical checks; the Cesium integration suite separately checks native ECEF positions, picking, display and resources. The original renderer's browser assertions in the table above are historical evidence.

## Historical close-up terrain capture

[Current screenshot gallery](screenshots/current/README.md)

This is an actual application render with synthetic checkpoint events, not a mockup. [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md) and [machine-readable report](gis-capture-report.json). The packaged Linux AppImage ran as an ordinary user, reopened the portable embedded-DTED study and restored its close-up camera. Both 1× and 4× were captured from the actual desktop and through attached MCP; native imagery used only cached tiles.

- Bounds: 79.99–79.91°W, 43.22–43.29°N, near Dundas/Hamilton, Ontario.
- Elevation: public Mapzen/Terrain Tiles `N43W080.hgt.gz`, one-arc-second source. [Format/source documentation](https://github.com/tilezen/joerd/blob/master/docs/formats.md) declares WGS84 coordinates and metre heights referenced to the WGS84/EGM96 geoid. Converted to standard DTED Level 2 with GDAL, without synthesising higher-resolution posts from DTED0. The mesh samples 129×129 vertices; displayed source heights are approximately 71–271 m MSL.
- Compressed source SHA-256: `2a707640ce6420fccccb736a9b7492b22f752bb27ab77314d9c1ac2a9b9a41fe`.
- Imagery: NASA GIBS `Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual`, nominal time `2000-12-01`, `GoogleMapsCompatible_Level12`. It is a **historical composite**, not current imagery. Native content resolution is about 30 m; zooming cannot add source detail.
- Exactly four unique WMTS tiles were fetched, sequentially through the app's 1 request/second gate. Capabilities used the existing cache. Subsequent captures made zero new public WMTS requests.
- **4× vertical exaggeration** is displayed in the app. This makes relief easier to see and is not a physical slope or height measurement.

The large external DEM is not committed to Git. Its public URL and digest are recorded here; the separately supplied `.chronoscope` demonstration can embed the converted terrain. Synthetic checkpoints are not surveyed control points.

## Geographic navigation

The current compass reflects Cesium's native camera heading, clockwise from geographic north; the UI shows a compact cardinal rose. Native camera position, direction and up vectors are stored together with their Cesium renderer marker. Original Three.js camera values are not interpreted as native ECEF/projected camera state; older workspaces fit their data when no compatible native camera is present.

The following describes the original renderer's compass correction and its historical checks:

The compass readout is the camera heading clockwise from true north. At **030° NE**, geographic north correctly lies to the left. The cardinal dial rotates with the north indicator, rather than leaving a misleading fixed N label above it. Flat view axes remain Web Mercator east/north; events are not rotated or edited by this UI correction.

Globe heading previously measured global scene azimuth, which varies with longitude even in a north-up view. It now intersects the centre viewing ray with the WGS84 ellipsoid and builds a local east/north/up frame from the ellipsoid normal. Heading and tilt changes preserve that ground focus. Camera up is saved with workspace/view state, with finite unit-vector validation; legacy workspaces retain their defaults. Heading is undefined at an exact pole, for which navigation uses a deterministic longitude-zero convention.

The retired Three.js `navigation-views-qa.mjs` exercised 108 orientation cases against EPSG:4978 local tangent vectors; those results are historical evidence. Current checks live in `navigation-qa.mjs`, `navigation-sphere-qa.mjs`, the independent ECEF references in `cesium-parity-qa.mjs`, and the numerical GIS/terrain unit tests.

## Supported contract and remaining limits

Inputs must already be **WGS84**. The app does not infer a datum from coordinate numbers and does not transform NAD27/NAD83, local datums, state-plane grids or arbitrary projected CSV coordinates. UTM hemisphere N/S is not an MGRS latitude band. Short MGRS references describe cells; the point is their centre and retains the cell-size/precision metadata. It is not an exact observed point.

EPSG:3857 is a distorted raster/display projection, not an area/distance measurement surface. Cesium flat modes use WGS84 geographic projection and Globe uses a WGS84 ellipsoid. The explicit terrain-datum choice above controls EGM96-to-ellipsoid display conversion. Original source heights and WGS84 latitude/longitude remain unchanged. Marker lifts avoid occlusion, exaggeration changes the appearance of relief and time height represents time; none is a measured physical altitude.

The bundled 2048×1024 Earth image is low-resolution reference imagery. Regional WMTS alignment is tested separately. Canonical coordinates and Rust calculations use f64; Cesium uses its own high/low position encoding and GPU rendering still has finite precision. The bundled EGM96 conversion does not provide arbitrary vertical-model transformations. General datum/epoch transformation, engineering scale/area tools, imagery orthorectification, global external terrain ingestion and survey certification remain outside the current implementation. Native Cesium terrain tiles refine the loaded local DTED; they do not imply a global elevation service or higher source resolution.

Reference specifications: [PROJ Web Mercator](https://proj.org/en/stable/operations/projections/webmerc.html), [GDAL DTED](https://gdal.org/en/stable/drivers/raster/dted.html), [GeographicLib GeoConvert](https://geographiclib.sourceforge.io/C++/doc/GeoConvert.1.html), [NASA GIBS documentation](https://nasa-gibs.github.io/gibs-api-docs/).

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
