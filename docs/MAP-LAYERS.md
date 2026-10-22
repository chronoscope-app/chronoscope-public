# Multiple WMTS servers and map layers

Chronoscope displays Streets by default and can also display imagery from several WMTS servers at once in space-time, 2D map and globe views. The combined image also drapes over loaded DTED terrain.

## Add sources and layers

1. Open **Maps → Advanced map settings → Add custom map server**, name your connection and enter its capabilities URL.
2. **Read capabilities** and choose the advertised layer, matrix set, style, image format and optional date. EPSG:3857 and EPSG:4326 matrix sets are supported; general raster reprojection is not.
3. **Add selected layer to map** appends that selection to the workspace. Repeat for another layer from this server or a different server.
4. Open **Maps → Advanced map settings → Custom layers** to enable layers independently, change opacity, move them up/down and set zoom visibility. The list runs from bottom to top. An opaque upper image covers lower images; transparent pixels and reduced opacity reveal them.

The saved-server library stores connection presets on this computer. Removing a library entry does not remove an already-added workspace layer. Editing a preset does not silently change other workspace layers that copied it. Up to 32 presets and 64 workspace layers are supported.

## Built-in Streets map

Streets is OpenFreeMap's **Positron** vector style, the single preselected default. It provides worldwide roads, labels and building footprints where OpenStreetMap has data, with detail selected automatically as the camera zooms. It needs no account or API key. Maps opens a simple Streets switch; there is no multi-provider built-in catalog.

One reusable offscreen MapLibre context renders 512-pixel Web Mercator tiles into Cesium's native imagery layer. Cesium retains the displayed camera, globe, terrain, imagery LOD and GPU tile cache. This is not a second interactive map overlay. The source-renderer corners are checked against the Cesium tile's geographic bounds within 0.1 pixel before accepting each image. A bounded queue, source cache and 24-image CPU cache avoid unbounded work or memory growth. The globe's public screen-space error is tightened to 1 while Streets is active to avoid enlarged low-resolution street labels, and restored when disabled.

Rust fetches only allowlisted OpenFreeMap HTTPS style, TileJSON, vector, font, sprite and low-zoom reference resources through the existing direct disk cache. Requests do not hold the workspace operation gate. The public service sees requested map areas, not Event records. Cache-only mode reuses downloaded resources; a new area can still require an online visit first. Metadata is refreshed separately from immutable versioned tile assets. There is no offline-area/prefetch downloader: cache-only mode only reuses ordinary browsing resources. OpenFreeMap [terms](https://openfreemap.org/tos/) limit any future offline-area download to 3,000 tiles or 50 MB and four parallel requests; implement per-area accounting before adding that feature. The current Streets protocol allows at most four simultaneous resource calls. A general disk-cache size is not an offline-area allowance. Source failures remain visible and **Retry Streets** recreates the renderer; failed source loading is not reported as successful blank imagery.

The same provider supports 2D, space-time and globe views and drapes over DTED. Streets stays on the ground when Event time elevation is enabled. OpenFreeMap, OpenMapTiles and OpenStreetMap credits remain visible and are included in PNG/MCP captures. Map data quality and coverage vary; the free public service has no SLA. See [OpenFreeMap](https://openfreemap.org/), [integration](https://openfreemap.org/quick_start/) and [attribution](https://openfreemap.org/#attribution).

Existing named custom servers and workspace layers are preserved. An old unmodified local single NASA default migrates to Streets. Older shared projects retain their explicit presentation. **Use Streets only** turns off custom overlays without deleting their saved settings. Legacy provider credit metadata remains available for old projects, but the old seven-item catalog is no longer offered.

CLI/MCP can read/change the choice with `preferences` and `{"preferences":{"basemap":"streets"}}` (or `"none"`). The setting travels in `.chronoscope` workspaces. `view_status` diagnostics include pending tiles, the last source error and the maximum observed alignment error. `wmts_servers` continues managing custom connections; its legacy `presets` array is empty.

## Automatic zoom switching

Minimum zoom is inclusive; maximum zoom is exclusive. Set streets to **0–14**, imagery to **14–30**, and enable both. Streets are visible below 14 and imagery at 14 or above. Overlapping ranges permit overlays. The layer manager shows current zoom and an approximate equatorial scale denominator at 96 dpi.

Zoom is the conventional Web Mercator camera-resolution value: `log2(2π × 6378137 / (256 × projected_metres_per_CSS_pixel))`, clamped to 0–30. It is measured at the view centre, independently of a provider's matrix numbering. Globe resolution uses the WGS84 ellipsoid; longitude differences wrap across the dateline. It is a display resolution, not a surveyed ground scale or the provider's matrix level. Views without a usable ground intersection report zoom 0. Automatic tile level remains separate; a manually selected provider level does not disable layer zoom rules.

Crossing a visibility boundary clears obsolete imagery immediately. Loading begins after a short camera debounce. Layers outside the range remain enabled in the project, with a muted sidebar row. Opacity 0 also suppresses loading.

## Save, share and automate

Saving a `.chronoscope` workspace includes every layer's connection, selection, order, opacity and zoom range. It does not embed downloaded imagery, credentials, smartcard identities or the local preset library. Recipients need provider access. Local disk caching and native WMTS authentication continue to apply per URL/origin; see [cache/WKT](MAPS-WKT.md) and [PKI](WMTS-AUTH.md).

CLI and inbound MCP use `preferences` with `preferences.map_layers`. Each entry contains `id`, `name`, `server_name`, `config` (the existing map configuration), `opacity`, `min_zoom` and `max_zoom`. Query `schema` for the exact contract. An empty array explicitly disables all layers. `null` uses the legacy single `preferences.map` configuration. Older projects open in that legacy mode. On a stack, an older client's map-only update changes the bottom layer and preserves the others. The legacy map field mirrors the first enabled layer for older readers; older releases cannot render the full stack. Use 0.12+ to edit shared stacked projects.

## Loading and limits

Two layer loaders share the normal Rust tile scheduler (eight network workers by default), cancellation and direct disk cache. They progressively composite into one image, so an extra source does not add a separate map mesh or terrain surface. CPU source/composite canvases share an approximately 32-megapixel budget; individual images are at most 4096 pixels per edge. Many overlapping layers can reduce effective image resolution and add decode/compositing cost. Zoom rules avoid unnecessary requests; they do not impose a test-only tile limit.

Failures are isolated by source. Check the reported error instead of assuming a missing overlay has no data. The existing viewport-bounds planner still has limitations for coverage spanning the antimeridian; the new wrap-aware zoom calculation does not remove that coverage limitation. Globe views near the horizon can require broad coverage. Offline caching depends on previously fetched regions/resolutions and provider terms.

Tests use two local synthetic WMTS services to check alpha blending, ordering, simultaneous coverage and zoom handoff without requesting public tiles. Physical GPU throughput and native macOS/Windows rendering require testing on those systems.
