# Comprehensive public-data exercise — 15 October 2026

This exercise uses the actual Rust engine, CLI, stdio MCP server and production browser frontend. It combines the automated regression suites with public-data imports, independent numerical oracles, live WMTS discovery/tile decoding, cached imagery playback and manual inspection of screenshots. All execution is local to a Linux VM. No GitHub runners, paid SI services, physical smartcards or native macOS/Windows machines were used.

## Defects found and fixed

| Finding | Correction and regression evidence |
|---|---|
| NASA FIRMS `acq_date`/`acq_time` was detected as a date without its acquisition clock. | Detect both acquisition header pairs. Parse numeric HMM/HMMSS clocks that lost a leading zero, only in clock context. Check every imported time and coordinate in all 95,718 detections; reject invalid clocks. |
| GBIF full ISO start/end intervals were rejected; month-only records appeared as exact first-day events. | Import full ISO intervals into start/end, flooring valid seconds at both endpoints. Represent `YYYY-MM` as the full month through its last minute. Preserve source attributes and explicit end-column overrides. Test reversed/unsupported intervals and leap/year boundaries. |
| Actual USGS ArcGIS WMTS layers advertise `image/jpgpng`, which both the planner and menu excluded. | Accept advertised JPG/JPEG/PNG MIME aliases without rewriting request templates. Continue decoding only bounded PNG/JPEG bytes. Include a captured official capabilities fixture and a local mixed-format menu regression. |
| A time-axis label could remain briefly after switching to 2D/globe while the GPU frame was queued. | Remove labels synchronously when changing modes; test before the next render. |
| Ground heat/bloom suppressed enabled source tracks in space-time. | Retain trails between bounded source observations above ground effects. Continue suppressing links between aggregate centres. Test real hurricane tracks with each effect. |
| Restoring a workspace could retain terrain and imagery from the preceding scene, even when the new workspace has none. | Cancel superseded resource loads, retire old terrain, and clear disabled imagery during restoration. The new offline GIS regression fails against the preceding bundle and passes with the correction. |

The generic browser test also used an obsolete saved-view selector following the unified Views panel change. Its test now opens **Saved views…** before interacting with the dialog. The WMTS composition oracle also now holds its geographic frame fixed for pixel comparisons, then restores camera callbacks before testing automatic zoom handoff. The original failed composition attempt and the successful targeted rerun are both retained in the final regression evidence.

## Real datasets

| Dataset snapshot | Rows | Checks |
|---|---:|---|
| USGS M2.5+ month earthquake feed | 1,895 | Every coordinate, magnitude and minute-floored timestamp; all five pattern analyses; save/reopen; table selection and regional globe navigation. Each earthquake is an independent entity. |
| NASA FIRMS Suomi-NPP VIIRS C2 global 24-hour feed | 95,718 | Every coordinate and acquisition timestamp; exact regional filter of 2,316 observations; bounded default display; portable save/reopen and browser rendering in both themes. |
| NOAA NDBC buoys 41009, 44013 and 46042, latest complete seven-day windows | 2,995 | Official station positions joined to observations; native Excel date/time cells in three worksheets; every time, position and wind value checked against the derived CSV; all five analyses. Space/time aggregation reduces 2,995 rows to 507; Undo restores the original count. |
| GBIF human observations in 2025, filtered to CC BY/CC0 records | 285 | Every position and start/end, including 31 full ISO intervals and 35 month-precision records; all five analyses; persistence. |
| GBIF Hamilton, Ontario observations | 43 | Real observations above a public SRTM-derived DTED2 surface and EOX Sentinel imagery; 2D and space-time captures. |
| USGS observations independently encoded as UTM and MGRS | 80 each | PROJ UTM inverse and GEOTRANS-backed MGRS cell-centre oracles, varied zones/hemispheres, mixed spaces and precisions from 100 km to 1 m. Both sets agree within 0.02 m. This tests arithmetic, not source survey accuracy. |
| Existing NOAA Atlantic hurricanes, 2021–2025 | 1,604 / 38 storms | Enabled source tracks with ground heat and bloom; heat disabled in the bloom capture. See the existing hurricane source/provenance documentation. |

[Sources, retrieval times and SHA-256 hashes](sources.json) identify the actual downloads. Public feeds change; a future download need not have these counts. [Core results](core-report.json) record the assertions. [Sample NOAA workbook](noaa-buoys-week.xlsx) is included for local import testing; import and append each worksheet. Set independent satellite detections to a shared default entity only with **Tracks disabled**. FIRMS `track` describes pixel footprint size; it is not a tracked fire identifier. Semantic mappings still need review.

Unzoned source timestamps use the import's default UTC assumption; verify the provider timezone before temporal comparisons. Day-only GBIF dates use midnight as the app's representation convention; this is not an observed hour. Month/interval records preserve their uncertainty range, while pattern analyses use observation start times. These findings must not be interpreted as proof of simultaneous real-world activity. FIRMS FRP is a sensor measurement, not incident area or a calibrated hazard score.

### Independent analysis check

Every pair among the 1,895 actual USGS observations was evaluated independently with `pyproj.Geod` on WGS84, using 1,000 m and 3,600 s thresholds. The app returned exactly the same **20 proximity pairs**, with no false positives or false negatives. [Oracle result](analysis-oracle-report.json). Existing Rust regressions independently exercise stationary, speed, gap and transitive-cluster boundaries.

### Editing and persistence

A mixed 2,180-row, two-source workspace passes append, selection/group restoration, tags, notes, batch editing, Undo/Redo, deletion/Undo, exact magnitude filtering, save/reopen, explicit all-record CSV export, and cursor pagination without duplicate or missing IDs. The export explicitly disables selected-only scope; otherwise a nonempty selection intentionally controls export.

## Maps and terrain

| Public service | Actual checks |
|---|---|
| NASA GIBS | 1,330 advertised layers; Blue Marble in EPSG:3857; decode, cache repeat and offline reuse. Hurricane captures reuse 24 previously cached basin tiles with zero new requests. |
| USGS ImageryOnly | Official ArcGIS `image/jpgpng` capabilities and actual imagery; level 8 single-tile compatibility and four regional level 10 tiles near San Francisco. |
| USGS Topo | Official mixed-format capabilities and decoded topographic imagery; level 8 single tile and four level 11 regional tiles. |
| EOX maps | Sentinel-2 cloudless 2024 in both GoogleMapsCompatible and geographic WGS84 matrix sets; decode/cache/offline reuse; four level 11 regional Sentinel tiles for the Ontario terrain capture. |

[Discovery](map-discovery.json), [cache checks](map-tile-report.json), and [regional tile settings](regional-map-report.json) record the parameters. Testing used concurrency **1** and at least **1,000 ms** between request starts. This is a testing preference, not a production loading restriction. There were only 17 distinct newly exercised tile URLs across these cases; repeats used the local cache. Some were already warm from an earlier attempt. Request counters are cumulative, so per-case new-request counts are not inferred from those totals.

The Austria basemap.at capabilities endpoint returned HTTP 403 in this environment. An obsolete FIRMS download URL returned 404; testing continued with the current official source. These are recorded availability boundaries, not successful integrations. No authenticated WMTS or physical PIN dialog was tested.

Ontario terrain uses the existing public Tilezen/Mapzen `N43W080.hgt.gz`, converted previously to WGS84 DTED2, with a 257×257 regional mesh. Source heights are MSL; no MSL-to-ellipsoid conversion is claimed. **3× vertical exaggeration** is visible in the capture. Imagery is a 2024 composite; observations are from 2025, not the imagery acquisition time. See [GIS accuracy and DEM provenance](../../GIS-ACCURACY.md).

The public screenshot harness deliberately plays back bounded real cached rasters into the renderer after resource timers settle. It does not exercise unrestricted live provider browsing. Automatic progressive loading, 64 local tiles, cache/offline reuse, multiple enabled sources, compositing/order and zoom visibility are exercised separately against deterministic local WMTS fixtures. This distinction prevents public traffic from growing during camera and mode tests.

## Scale result and remaining performance work

The synthetic scale case is explicitly separate from the real datasets. It streams **1,000,000 rows** from an 80.6 MB CSV and verifies exact counts against a deterministic independent generator:

| Operation | Result / observed time |
|---|---|
| Import | 1,000,000 accepted, zero rejected; 313 s |
| Value >90 | Exactly 90,000; 0.588 s cold, 0.0016 s repeated |
| Time window | Exactly 120,000; 0.242 s |
| Geographic filter | Exactly 83,370; 0.282 s |
| Large selection | Exactly 90,000 selected, bounded returned ID list; 0.371 s |
| Default map packet | 144 count cells, no unselected raw point upload; 14.47 s cold, 1.01 s warm |
| Portable save | **Blocked by VM free disk capacity**; structured `RESOURCE_LIMIT` returned and incomplete output removed |

These timings come from an **unoptimized Rust build on shared virtual CPU**, not a release benchmark. Engine RSS sampled after commands stayed below 120 MiB; that excludes OS page cache, browser memory and transient peaks. The working SQLite database reached about 1.7 GiB and requires additional space for journals and portable copies. The VM started with about 2.5 GiB free. Million-record save/reopen and million-record browser FPS were **not** established. The 95,718-row real workspace did save/reopen successfully. [Full scale result](scale-report.json).

Priorities supported by this measurement are release-profile cold-packet profiling and large-workspace storage/save headroom. Reducing draw calls alone will not remove ingest, indexing, disk, query or first-summary costs. Physical GPU FPS, macOS WebView behavior and long-running memory/thermal behavior need hardware testing.

## Verification and screenshots

The [local regression report](regression.json) and its logs cover formatting, strict core lint, **196 Rust tests**, generated contracts, production frontend build, three frontend unit suites and **nine browser suites**. Features include CSV/Excel mappings, WKT holes/multipart picking, all four views and wheel/buttons, 26k viewport refinement, linked selection, table ranges, save/recovery, SI mock-service operations, MCP client transports, aggregation/Undo, time-only triangles, clusters/density/heat/bloom, playback fades, compass direction/roll and imagery preservation. [Public UI results](public-ui-report.json) cover the real-data workflow. [MCP result](mcp-report.json) covers a separate stdio handshake, 76 discovered tools, exact real-data queries, root-escape rejection and JSON-RPC-only stdout; the one-shot JSON CLI returned the same dataset count.

Additional [software WebGPU](display-webgpu.json) checks exercise the actual WebGPU backend, not a WebGL fallback. SwiftShader supplies that backend; this establishes code-path correctness, not dedicated-GPU performance. The Linux Tauri build/CLI result is recorded separately in [native checks](native-report.json). Its graphical WebView was not exercised; the frontend was tested in Chromium. This does not establish native macOS/Windows operation. No signing/notarization, paid SI-provider evaluation, browser-native draft WebMCP integration or physical smartcard test is claimed. The archived extension bridge remains disabled.

- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md) — bundled coarse global imagery, not a high-resolution regional basemap
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)
- [Current screenshot gallery](../../screenshots/current/README.md)

Raster captures are application output, not independent pixel-level geodetic validation. GBIF observations retain their original keys and licenses in [the screenshot attribution list](gbif-screenshot-attribution.csv); occurrence URLs are `https://www.gbif.org/occurrence/{sourceKey}`, with dataset URLs `https://www.gbif.org/dataset/{datasetKey}`. Observer names were omitted. EOX imagery: Sentinel-2 cloudless by [EOX](https://s2maps.eu/), containing modified Copernicus Sentinel data (2024). NASA imagery: NASA GIBS Blue Marble. NOAA/USGS examples credit their respective public-data agencies.

## Repeat locally

```sh
cargo build --locked -p chronoscope --bin chronoscope
npm --prefix frontend ci
python3 scripts/validate_local.py --browser --chromium /path/to/chromium
# On a configured native build machine, add --native.
```

`frontend/scripts/public-data-qa.mjs` is opt-in and requires the prepared matching snapshot inputs via `CHRONOSCOPE_PUBLIC_QA_DIR`. It never downloads public data. The normal regression suites use local fixtures; they do not rely on changing public feeds or contact public WMTS servers. Input schemas and generated contracts are unchanged by these fixes.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
