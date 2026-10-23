# Shapefile and vector GeoPackage imports

Use **Open** and select a `.shp` or `.gpkg` file. Choose **Add reference layer**
for shapes and attributes without a required timestamp, or **Import as Events**
to review timestamp/entity mappings and use Chronoscope's Event filters and
analysis. The same inputs work through CLI/MCP `file_probe`, `gis_load` and
`import_preview`. Packaged layers can later use `gis_import_preview`.

## Supported inputs

- **Shapefile:** XY Point, Polyline, Polygon and MultiPoint, including multipart
  lines/polygons and polygon holes. Matching `.shx`, `.dbf` and `.prj` companions
  must be in the same directory. Standard dBASE III character, numeric, float,
  logical and date attributes are retained. An optional `.cpg` declares text
  encoding; UTF-8 and Windows-1252 defaults are accepted only for recognized DBF
  metadata. Unknown code pages require `.cpg`. Malformed text is rejected.
- **GeoPackage:** standard XY Simple Features from up to 64 ordinary vector
  feature tables, explicitly declared as EPSG:4326. All tables are combined into
  one reference layer. `source_layer` retains the original table name; if that
  column already exists, the additional column is `chronoscope_source_layer`.
  If both names are already present, import fails rather than overwrite data.
  Feature IDs combine escaped table names with exact INTEGER primary keys.
  NULL geometry retains attributes and can become a time-only Event.

Imported reference layers retain Shapefile/GeoPackage labels and the source
filename. Internally they use the existing GeoJSON presentation format for
portable geometry. Portable saves include the normalized document and
the exact original files; recipients do not need the source folders. GeoPackage
table names are available in the attribute table and Event source attributes.

## Limits and explicit failures

- Inputs must already use WGS84 longitude/latitude, X then Y. Shapefile `.prj`
  accepts bounded WKT1 `GEOGCS` definitions whose datum, ellipsoid, prime meridian
  and degree units are checked. Arbitrary projections, other datums, WKT2 and
  latitude-first axes require reprojection/export before import.
- XY only. Z/M, MultiPatch, curved/solid geometry and non-NULL empty GeoPackage
  geometry are rejected. Export empty geometry as NULL when needed. Original
  coordinates are never silently padded, reprojected or stripped of dimensions.
- Shapefile geometry/index/attribute counts and offsets must agree. Deleted DBF
  rows require packing/export in the source application. Memo/FoxPro tables and
  symlinked companions are rejected.
- GeoPackage vector tables require one INTEGER primary key. Views, generated or
  hidden columns, binary attributes and unsupported extensions are rejected.
  Standard `gpkg_rtree_index` and `gpkg_crs_wkt` metadata are allowed, but their
  indexes/definitions do not replace the EPSG:4326 requirement.
- GeoPackage raster/attribute-only tables are not imported as features; their
  presence is reported and the original database remains packaged. Raster-only
  files are rejected. A database with pending WAL changes must first be closed
  or checkpointed by its source application.
- Source files, including all Shapefile companions together, are limited to
  **64 MiB**; normalized GeoJSON is also limited to 64 MiB. Limits include
  250,000 features, two million total vertices, 50,000 vertices/parts per feature,
  and 32 geometry nesting levels. Native reference display retains the existing
  50,000-feature limit; larger supported inputs can use Events conversion.
- Existing geometry validation applies, including polygon topology and explicit
  antimeridian splitting. The reader does not infer missing timestamps.

## Dependency and parser safeguards

Registry versions and hashes are recorded in `Cargo.lock` and
[the dependency review record](security/vector-readers.json). Only the needed
Rust features are enabled; GDAL, PROJ, GEOS, SQLx and MVT are not added. SQLite is
the existing C implementation already used by Chronoscope, not a Rust rewrite.

Binary files are snapshotted before normalization. Shapefile counts, record
sizes, index offsets and DBF layouts are checked before reader allocation.
GeoPackage geometry has a nonallocating pass that checks every nested type,
dimension, count, byte order and coordinate before an allocating conversion.
GeoPackage SQLite reads a private snapshot opened read-only, with trusted schema
disabled, no attached databases, SQL/column/value limits and a cancellation/time
budget. Imports do not enable extension loading or execute source-supplied SQL.

These bounds and focused malformed-file tests reduce risk; they do not establish
that dependencies are free of malicious code or undisclosed vulnerabilities.
Some Rust dependencies contain `unsafe` code. Updates require renewed source,
feature, checksum and advisory review.

## Local verification

Use Rust 1.96+ and Node 22+. After `npm --prefix frontend ci`:

```sh
cargo test --locked -p chronoscope --test vector_gis --test gis_files --test import_workspace
cargo test --locked -p chronoscope --lib gis::vector
cargo build --locked -p chronoscope --bin chronoscope
node scripts/generate_contracts.mjs --check
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:vector-gis
```

The browser check uses `/usr/bin/chromium` by default; set
`CHRONOSCOPE_CHROMIUM` to another Chromium executable when necessary. It runs
the real Rust engine and enforces the desktop content security policy while
blocking external requests. Native macOS/Windows packaging remains a separate
verification step.
