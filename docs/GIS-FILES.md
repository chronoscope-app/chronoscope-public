# GIS files in Chronoscope 0.14

Use **Open** for workspaces, CSV/Excel data and these Cesium-supported formats:

| File | Native reference display | Events import |
| --- | --- | --- |
| GeoJSON (`.geojson`, recognised `.json`) | Points, lines, polygons/holes, multipart and geometry collections; simplestyle | Geometry and source properties; detect/map a timestamp |
| TopoJSON (`.topojson`, recognised `.json`) | Native topology loader | Decode transforms, delta arcs and reversed arcs; retain object names/properties |
| KML/KMZ | Native styles, geometry, overlays and supported time features; KMZ companion assets | Placemarks, TimeStamp/TimeSpan, ExtendedData and gx:Track samples |
| CZML (`.czml`, recognised `.json`) | Native entity properties, positions, availability, paths and supported models | Fixed WGS84 cartographic/Cartesian position samples and supported static geometry; native-only constructs remain reference objects |
| GPX | Waypoints, routes, tracks and native time animation | Point records, timestamps, elevations and track/segment attributes |
| 3D Tiles (`tileset.json`) | Native local tileset streaming and LOD, including packaged tile payloads | Reference asset; no fabricated Events |
| glTF/GLB | Native models with explicit WGS84 placement and scale | Reference asset; no fabricated Events |

JSON is identified by content, so legacy workspace JSON still opens as a workspace. Select the `tileset.json` entrypoint for a tile hierarchy; individual B3DM/PNTS/I3DM/CMPT/subtree payloads are companion assets, not independent georeferenced projects. Service APIs such as I3S, Cesium ion, remote terrain catalogs and non-native formats such as shapefiles, GeoPackage and geodatabases are outside this local-file implementation.

## Reference layers or Events

**Add reference layer** retains native source presentation. A timeless boundary needs no date. Layers have visibility, Fit, naming, original attribute inspection, selection and removal controls. Double-click a tabular GIS layer for its continuous table; the ellipsis/right-click menu opens settings and conversion actions. Table rows support click, Ctrl/Cmd-click and Shift-click. Reference selection is separate from Event selection and limited to 1,000 records; native tracks/animated objects can represent multiple source samples. The reference table provides search, sortable headers and continuous scrolling, with at most 32 original property columns shown alongside canonical reference fields. CLI/MCP can request all original property fields on bounded pages. Follow `next_offset`/`returned_count`; `expected_revision` guards subsequent pages. Selection validates exact source feature IDs, including multipart objects. `view_navigate` can fit an enabled reference layer and `view_status` reports its native loading/readiness.

**Import as Events** opens the normal mapping/validation preview. Review timestamp and entity mappings and choose Append to retain existing Events. Missing or ambiguous dates require an explicit mapping/default; no dates are invented. Imports use UTC fractional-second precision, original attributes and full WKT geometry. CSV exports include `location_kind` so derived positions remain identifiable. You can also convert a packaged layer from its settings after the original files have been removed. Native-only CZML constructs, inertial positions, model/tile content and native presentation styles are not converted into invented analytic geometry.

Native CZML/GPX time uses the shared time focus/Play control. The timeline range includes enabled native time layers, while histogram counts continue to represent actual Events. Availability and animation follow Cesium's supported source semantics. Reference features stay at their source physical heights/on the map; importing as Events enables time elevation in space-time or the optional globe time view. GIS Z values are retained in consistent-dimensional WKT but do not become Event altitude. Mixed-dimensional GeoJSON is normalized to XY WKT with the complete original geometry retained in an original-geometry attribute.

Native reference layers use Cesium's loader support and limitations, rather than a complete desktop GIS translation of every extension. KML NetworkLinks, automatic refresh, remote links and rich HTML descriptions are disabled for local-file display. Source ExtendedData/descriptions remain available in the Rust attribute table. Linked local styles, imagery and model assets are packaged. General CRS reprojection and GIS source vertical-datum conversion are not performed: GeoJSON/TopoJSON must be WGS84; model placement is longitude/latitude and WGS84 ellipsoidal metres. Native KML altitude-mode, glTF and tileset transform semantics apply. Reproject/convert heights before import when the source requires it. Existing DTED datum controls remain separate.

## Polygon Events and centroids

Polygon and multipolygon Events retain their complete timestamped boundaries, holes and attributes. By default, each also has a **derived polygon centroid** circle, which can anchor entity tracks, clustering, density, heat/bloom and point-based analyses. **Views → Polygon centroid markers and tracks** hides those anchors without removing the polygons.

Centroids use area-weighted vector integration on the WGS84 authalic sphere. WGS84 geodesic edges are densified at intervals of at most 25 km before integration; hole areas subtract and multipart areas add. This is a documented surface-centroid definition, rather than averaging longitude/latitude vertices or using the bounding-box centre. Equatorial symmetry, reversed winding, holes, multipart weights, a spherical octant, high latitude and split date-line cases have numerical tests. Near-cancelling/undefined centroids remain unavailable. A centroid can lie outside a concave polygon or inside a hole: it is not an interior-point calculation.

Canonical coordinates and `location_kind: "polygon-centroid"` explicitly identify the derived anchor; original WKT/source geometry remains unchanged. The inspector and hover text label the derivation. Point-based proximity, movement, heat and density calculations then use these centroids, not polygon-to-polygon distances or areal coverage; interpret results accordingly. Spatial bounds still use exact full-geometry intersection, including holes. Lines and mixed point/line collections do not receive polygon centroids. Old workspaces gain eligible anchors in their disposable working copy; the original file is not overwritten.

## Portable workspaces, not CZML projects

Keep **`.chronoscope`** as the project format. CZML is useful for scene interchange and animated presentation, but does not encode the complete indexed Event database, filter state, analysis context, table state, SI settings boundaries, map stack, DTED resources and all other imported GIS packages.

Projects containing GIS reference layers use the existing SQLite `.chronoscope` container, with version-5 project metadata and checksummed asset blobs. Each import has a hash-addressed local asset package; raw data is excluded from snapshots. Save embeds the packages and their local companions. Recipients do not need the original source folders. Existing ZIP/SQLite projects still load. Version-5 centroid/GIS projects require Chronoscope 0.14 or newer. Legacy JSON saves reference managed resource files and are not portable. Automatic local copies also reference managed assets to avoid copying large packages every 30 seconds; retain the local profile if relying on those copies. Explicit Save produces a portable deliverable.

## Performance and file boundaries

Native reference loaders have a 50,000-extracted-feature limit; Events conversion supports up to 250,000 extracted records per GIS input, then uses the indexed Event renderer's normal clustering/culling budgets. Native entity layers do not inherit the Event renderer's LOD, filters or analysis automatically. Large GIS datasets should use Events conversion or tiled 3D content.

Text sources are bounded to 64 MiB. Asset files are bounded to 256 MiB, a package to 512 MiB/8,192 files, and a workspace to 64 GIS layers/2 GiB of GIS packages. Only linked companions inside the selected source directory are collected; unrelated neighboring files are excluded. Implicit tile templates collect matching local resources. Symlink escapes, traversal paths, ZIP duplicates/expansion abuse, unsupported CRS and malformed coordinates are rejected. Data integrity checks apply before attaching a reopened package.

The public Cesium Resource adapter reads packaged assets through bounded Rust `gis_read` chunks, four concurrent reads and a 64 MiB LRU. There is no new listening proxy, arbitrary `file://` access or cloud upload. Native 3D Tiles uses a 256 MiB cache and 128 MiB overflow allowance. Hidden layers do not initiate loading. These are application bounds, not an operating-system process sandbox; complex source styles and GPU resources still have rendering costs.

## CLI and MCP

The same authored registry exposes `file_probe`, `gis_load`, `gis_layers`, `gis_set`, `gis_remove`, `gis_read`, `gis_table` and `gis_import_preview`. Mutation controls, scoping, dirty tracking and bounded output use the existing engine. Rename/visibility/placement/selection/removal changes are undoable; file ingestion is staged before attaching the layer. `gis_load` and conversion preview can run as jobs.

```sh
chronoscope --attach call gis_load --args '{"path":"/absolute/path/zones.geojson"}'
chronoscope --attach call gis_layers
chronoscope --attach call gis_table --args '{"id":"LAYER_ID","limit":50,"sort":"entity"}'
chronoscope --attach call gis_set --args '{"id":"LAYER_ID","enabled":false}'
chronoscope --attach call view_set --args '{"gis_table":"LAYER_ID","table_open":true}'
chronoscope --attach call gis_import_preview --args '{"id":"LAYER_ID"}'
```

For a model, add `"position":[longitude,latitude,ellipsoidal_height_m]` and optional `"scale":1` to `gis_load`. For Events conversion, pass the returned `import_id` and reviewed mapping to `import_commit`. Standalone `call gis_load --args '…' --output study.chronoscope` creates a portable workspace; `--project study.chronoscope call gis_layers` inspects one without the GUI.
