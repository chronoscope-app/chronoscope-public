# Map caching, WMTS loading and WKT geometry

## Direct map cache: no proxy required

Chronoscope fetches WMTS resources directly and keeps a private disk cache on the same computer. This is ordinary client caching, not a proxy server, and adds no listener, service, account or administrator requirement. The optional MCP/development bridges are unrelated to map caching.

Open **Map servers → Cache and loading**:

- **Concurrent downloads:** default 8, adjustable 1–32. Native macOS client-auth helper IPC currently serializes requests; this setting is a worker budget, not a platform throughput guarantee.
- **Minimum request interval:** default **0 ms**, meaning no application-imposed delay. An optional positive interval is available for restrained testing or a provider's policy. Our testing uses local fixtures/cached public imagery, or explicitly restrained public requests.
- **Disk cache limit:** default **8192 MiB**, adjustable; **0 means unlimited disk use**. Oldest files are removed when over quota. Choose a limit appropriate for your machine.
- **Tile freshness:** default **30 days**. Capabilities retain their one-day freshness policy. Offline mode can reuse older cached resources.
- **Use cached maps only:** disables all map network access. A missing tile/capability reports a cache miss; it does not quietly go online.
- **Clear cache:** removes downloaded resources from this computer. It does not modify events or projects.

The cache is separate from `.chronoscope` workspace files. View the desired area/layer/date online to populate it, then use cache-only mode to revisit that same coverage. Selecting another matrix level, layer, style, date, URL or identity may need different cache entries. Offline mode does not synthesize absent detail. Authentication scopes remain isolated; PINs/private keys are not cached. Respect providers' licensing and offline-cache terms.

## Full requested WMTS coverage

The old one-request-per-second delay and 16-tile **viewport** cap were testing restrictions and are removed from normal loading. A chosen matrix level is honored. Automatic resolution considers the canvas size; it no longer silently drops resolution just to fit 16 tiles. Resolution remains bounded by what the provider advertises. Map loading can be stopped; cancellation interrupts active Rust HTTP waits and completed tiles remain cached. Map I/O does not hold the workspace lock, so filtering/selection remain available.

Coverage loads in bounded pages, so 16 tiles is a default **response page size**, not a cap on a view. In validation, a local WMTS served all 64 tiles of the requested view, with overlapping downloads; repeating it and cache-only loading made zero additional tile requests. The globe composites a viewport atlas with one imagery sample instead of omitting tiles after the first 16. The GUI streams pages of eight decoded tiles into one viewport canvas up to 4096 pixels per dimension; each tile image is released after composition and terrain/globe reuse that canvas. Flat imagery occupies one mesh, independently of the total tile count. Actual GPU/WebView memory and texture limits still apply. Atlas pixel limits are rendering resource limits, not request-rate restrictions.

HTTP 429 imposes a server cooldown (Retry-After where available), with no automatic retry storm. Individual resources still have response/dimension/time budgets to bound malformed or hostile responses. There is no guarantee that every advertised global high-resolution level can fit in local memory. Camera changes request the visible regional coverage and automatic detail; an explicitly chosen level stays fixed. This is regional camera-driven loading, not a global globe tile pyramid or terrain streaming system. WMTS bounds must be a non-crossing region within Web Mercator latitudes.

CLI/MCP:

- `wmts_access`: inspect settings/cache size; optional `settings` merges local changes.
- `wmts_cache_clear`: clear disk cache.
- `wmts_plan_page`: `config`, `bounds`, optional `level`, `target_pixels`, `offset` and `limit`. Returns `tiles`, `total_tiles`, `next_offset`. No imagery downloads.
- `wmts_rasters`: same paging arguments, default page 16; returns total/next offset and tile/cache counters. Continue until next_offset is null.
- `wmts_plan` retains the legacy array response for plans up to 4096 entries; larger plans direct agents to the paged operation. There is no silent coarsening.

## WKT in CSV or Excel

The import dialog detects headers such as **geometry**, **geom**, **wkt**, **geometry_wkt** and matching sample values. You can change/unmap **WKT geometry** manually. Nonempty WKT takes precedence over other coordinates for that row; empty source cells fall back to the normal coordinate mapping. Records still need a timestamp as with other Chronoscope events.

Supported OGC Simple Features:

```text
POINT(-79.96 43.25)
LINESTRING(-79.98 43.24,-79.95 43.26,-79.92 43.28)
POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,1 2,2 2,2 1,1 1))
MULTIPOINT((-79.94 43.245),(-79.93 43.25))
MULTILINESTRING((0 0,1 1),(2 2,3 3))
MULTIPOLYGON(((0 0,1 0,1 1,0 0)))
GEOMETRYCOLLECTION(POINT(0 1),LINESTRING(1 2,3 4))
POINT EMPTY
POINT ZM(-79.96 43.25 125 900)
SRID=4326;POINT(-79.96 43.25)
```

**X = WGS84 longitude; Y = latitude.** WKT alone does not specify a CRS, so the import dialog explicitly assumes WGS84. There is no axis guessing/swapping. EWKT SRID=4326 is accepted; another SRID is rejected with a request to reproject first. CRS-definition WKT (`GEOGCS`, `PROJCRS`, etc.), curves, TIN and solid extensions are not implemented. Z/M/ZM values and original spelling remain in `geometry_wkt`; they are not interpreted as terrain altitude or event time.

GeoRust parses grammar and validates topology. Invalid coordinates, nonfinite values, open polygon rings, self intersections and unsupported CRSs enter the normal rejected-row review. Source limits are 512 KiB WKT text, 50,000 vertices and 32 nesting levels per record. Edges that jump across ±180° must be explicitly split into multipart geometries before import, avoiding false world-spanning segments.

The [seven-type regression CSV](../tests/fixtures/import/wkt-geometries.csv). It contains **synthetic** Niagara-region shapes, including a polygon hole, supports repeatable import and terrain-overlay checks.

## Geometry behavior

POINT sets the actual scalar latitude/longitude. Polygon/multipolygon Events retain full geometry and gain an explicitly derived WGS84 authalic surface centroid in scalar coordinates, labelled `location_kind: polygon-centroid`; holes subtract and multipart areas add. A centroid is not guaranteed to lie inside the area. Lines and mixed point/line collections retain null scalar point coordinates. Non-point geometries do not become time-only triangles. Located-only filters include nonempty geometry. Geographic bounds use an indexed envelope followed by actual shape intersection, so a rectangle entirely inside a polygon hole does not select that polygon.

Map/space-time display polygon holes and boundaries, lines and multipoints. Flat polygons are filled using hole-aware triangulation. Terrain and globe use boundaries rather than coarse fills that could cut through relief. Supplied WKT edges stay linear in source longitude/latitude and are densified for globe curvature/terrain sampling. Terrain/point display offsets are visual clearances; source Z values are not used as measured altitude. Flat portions beyond Web Mercator latitude limits are omitted with a notice; use Globe for polar geometry.

Click a line, point or filled area to inspect/select it, or use its attribute-table row/normal filters. Box selection covers displayed vertices and the region center; it is a screen operation, not exact geometric region intersection. Use geographic bounds queries for exact shape intersection. Shared selection changes geometry highlighting. Rendering is bounded to 1000 non-point features/200,000 source vertices in the UI and 800k line segments; a status notice requests narrower filters if limited.

Original WKT is editable in the inspector and through CLI/MCP `edit`, queryable as `geometry_wkt`, exported as a canonical CSV column and saved in workspaces. Editing WKT revalidates it and synchronizes POINT coordinates. Editing scalar coordinates detaches the old WKT geometry. Existing point-distance/pattern tools do not calculate distance to entire lines or areas; non-point shapes are excluded from point-specific analysis.

`render_geometries` exposes bounded shape parts/counts/bounds to agents separately from packed point render packets. `query`/`attribute_table` preserve original WKT. Shared geometry workspaces use ZIP v4, or SQLite v2 for large datasets; use Chronoscope 0.7+ to open them. Older ZIP v1–3 and SQLite v1 workspaces remain readable, with SQLite migration confined to the disposable working copy. The source workspace is never altered on open.


In 0.9, resource changes invalidate pending map/terrain generations even when the data revision is unchanged. Decoded imagery and terrain results check that generation before publication. Terrain mesh reuse preserves the exact bounds, resolution, voids and registration; it is not a lower-detail substitute. `cache_hit` reports full mesh reuse, with zero new decoded tiles for that request. Normal app concurrency remains configurable; historical gentle public-server testing limits are not app limits.


Version 0.10 added the local named WMTS server library; 0.12 adds a separately managed workspace layer stack. Map servers → Add server saves a name/URL and layer/matrix/style/date/format/resolution choices. **Add selected layer to map** appends a layer from the selected preset. **Map layers** enables multiple sources simultaneously, sets opacity/order and assigns minimum/maximum zoom ranges for automatic street/imagery handoff. Up to 32 library presets stay local; up to 64 workspace layers travel with a saved project. `wmts_servers` manages presets; `preferences.map_layers` manages workspace layers. Legacy `preferences.map` remains compatible. See [multiple map sources and zoom rules](MAP-LAYERS.md).
