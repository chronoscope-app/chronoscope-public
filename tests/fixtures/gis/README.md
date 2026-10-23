# GIS fixtures

`events.geojson`, `boundaries.topojson`, `timed-zones.kml`/`.kmz`, `moving.czml` and `track.gpx` are synthetic Chronoscope fixtures. They describe fictional Atlantic warning areas/stations/survey paths, not real warnings or measurements. Their independent coordinates, UTC times, holes and reversed TopoJSON arcs support repeatable tests.

`box/Box.gltf` and `Box0.bin` come from the Khronos glTF Sample Assets [Box model](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box). Copyright © 2017 Cesium, licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/legalcode). Retrieved 2026-10-16. `Box.glb` is a derived binary packaging of that same model; `tileset.json` is an independently authored 3D Tiles 1.1 wrapper with an explicit WGS84 ENU transform at longitude −79°, latitude 25°, ellipsoidal height 0 m, enlarged 20,000× for display testing. This is a rendering test object, not surveyed infrastructure. No Cesium ion service or account is used.

These are internal regression fixtures, not example datasets. Tests load them through the shared import/GIS APIs. For glTF/GLB, explicitly choose a model location and scale. Select `box/tileset.json` for the self-georeferenced tile example. See [GIS workflows](../../../docs/GIS-FILES.md).

## Binary vector fixtures

`vector/` contains first-party synthetic, MIT-licensed WGS84 XY Shapefiles and a multi-table GeoPackage. Regenerate with `python scripts/generate_vector_fixtures.py`; the generator uses Python struct/SQLite and does not use the Rust readers. The examples include timestamps, UTF-8 attributes, lines, polygon holes, multipart polygons, MultiPoints, exact 64-bit source IDs and NULL geometry. SQLite container bytes can vary by SQLite version; the logical contents are fixed.
