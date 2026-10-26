# CLI and MCP — Chronoscope

Chronoscope’s desktop, CLI and MCP share the Rust engine and enforced command schemas. The generated MCP registration and server name are `chronoscope`. Tool names (`chronoscope_*`), resource URIs and portable workspace files retain their contracts. See [Mac installation and profile migration](MAC_HANDOFF.md). Build the CLI without a graphical toolkit:

```sh
cargo build --locked --release -p chronoscope --bin chronoscope
chronoscope --help
chronoscope schema
chronoscope schema query
```

`schema` lists the MCP tool contracts; `schema COMMAND` returns the domain input schema. IDs are exact decimal **strings**, including values beyond JavaScript's integer range. Time is UTC Unix seconds including fractional seconds. Coordinates normalize to WGS84 DD; DD, UTM and variable-precision/spaced MGRS remain supported.

Fractional timestamps are supported throughout queries, edits, filters and analyses. For example, `time_parse {"value":"2026-10-13T08:15:59.123456Z"}` returns a numeric fractional `epoch`, its UTC string and `precision:"fractional_second"`. Time thresholds such as `tolerance_s`, `duration_s` and `gap_s` accept fractional seconds. Calendar time series support `second`; Charts supports `millisecond`, `second`, `minute` and larger intervals, or `none`. FFT `bucket_seconds` accepts widths from one microsecond upward subject to the canonical clock's representable precision and existing bucket limits.

## Field contents and completeness

`dataset_schema` discovers names and imported types. `field_profile` reads actual data for any canonical/derived field or imported column:

```sh
chronoscope --attach --json call field_profile --args '{"fields":["label","time_utc","tags"],"scope":"visible"}'
chronoscope --attach --json call field_profile --args '{"fields":["attribute:Temperature"],"scope":"all","example_limit":3}'
```

Replace imported names with columns from your project. `chronoscope_field_profile` is the equivalent read-only MCP tool and is also available to hosted SI. It returns exact scoped present/null/empty/distinct/finite-numeric counts and bounded examples with exact Event IDs. Imported display names resolve when unambiguous; explicit `attribute:<name>` resolves collisions. `scope` is `visible` (default), `all`, or `selected`; selected respects current filters. Optional `source` and `expected_revision` constrain the read. `example_limit` is 0–5 per field, with at most four fields per call. `sampled:false` refers to counts; examples do not establish frequencies. Long values are explicitly omitted. Unknown fields fail; they are not reported as empty. No analysis artifact or source edit is created. Large inspections can use `job_start` with progress and cancellation.

## Live Cesium view (0.14.1)

Attach to the running desktop to inspect or navigate its actual view. `capabilities.renderer` advertises Cesium/WebGL2 and live commands; it does not prove hardware acceleration. `view_status` (also the MCP resource `chronoscope://view`) returns actual camera/scene state, backend, WebGPU API availability, viewport, renderer diagnostics, imagery/effect loading and native GIS readiness. A WebGPU API may exist even though this Cesium implementation uses WebGL2. `snapshot.scene` is stored workspace state; use live status for rendering evidence. Native camera coordinates are mode-specific display state, never measured Event coordinates.

```sh
chronoscope --attach view status
chronoscope --attach view fit
chronoscope --attach view fit --layer LAYER_ID
chronoscope --attach view look-at --longitude -79 --latitude 25 --height 0 --distance 500000 --heading 30 --tilt 40
chronoscope --attach view zoom 2
chronoscope --attach view north
chronoscope --attach view capture --output capture.png
chronoscope --attach view capture --target map --output map.png
chronoscope --attach view capture --window si-chat --output chat.png
```

Use `view_set` to choose space-time/map/globe before navigating. Geographic look-at uses WGS84 longitude/latitude and ellipsoid height in metres. Distance is eye-to-target range, except 2D Map where it sets map width in metres; 2D heading/tilt must be zero. Heading is clockwise from north; tilt zero looks straight down. `fit_layer` requires an enabled native GIS layer. Fit can request `whole_globe:true` in Globe mode. The matching MCP tool is `chronoscope_view_navigate` with actions `fit`, `fit_layer`, `look_at`, `zoom` and `north_up`; it returns live state after camera persistence, while assets may still be loading. Poll `view_status.loading` and each enabled layer's readiness rather than assuming an accepted command rendered all content.

These live tools require a responsive attached GUI; headless engines return UNAVAILABLE. Navigation is outside data undo/atomic batches and accepts no dry-run/idempotency/revision controls. After timeout/cancellation inspect live status before repeating relative zoom. PNG capture uses MCP image content; the dedicated CLI command saves it atomically and requires `--overwrite` to replace an existing file. Generic `call --output` still means saving a workspace, not saving a screenshot.

### Whole-app screenshots

`chronoscope_view_capture {}` now captures the **whole visible main app content**, including the map, sidebars, Charts, attribute table, timeline, docked SI chat and any visible app dialog. `{"target":"map"}` retains the previous attributed canvas-only export. `{"window":"si-chat"}` captures the open detached SI chat window. The default is `{"target":"app","window":"main"}`; map capture is valid only for the main window. Returned metadata identifies `target` and `window`; MCP returns the PNG as image content without duplicating base64 in structured metadata.

App captures use native WKWebView, WebKitGTK or WebView2 snapshots of the visible viewport, not a reconstructed HTML image or an operating-system screen capture. Native window decorations, the macOS menu bar, system file pickers and other windows are outside that viewport. Scrolled-off content is not expanded; a detached chat requires a separate capture. Captures do not focus, unminimize or otherwise navigate the window. A closed, hidden or minimized target returns UNAVAILABLE. Browser preview and standalone engines cannot provide native app snapshots; there is no silent map-only fallback.

App snapshots preserve the entire visible layout and proportionally reduce high-resolution output to at most 2560 × 1920 pixels. Native source size, decoding memory, request concurrency, image bytes and wait time are bounded. App capture shows the current loading/error state rather than requiring the map to finish loading; for a settled map export, inspect `view_status` or use `target:map`, whose existing readiness checks still apply. SI's Capture map/presentation feature continues to request map-only images.

### Native window video recording

`chronoscope_view_recording` records the displayed Chronoscope window through
ScreenCaptureKit on **macOS 15 or later**. It captures real compositor frames,
including the app's panels and window chrome, rather than polling screenshots.
Only this process's `main` or `si-chat` window is eligible; audio and microphone
capture are disabled. Other platforms and browser preview return `UNAVAILABLE`.

```json
{"action":"start","path":"map-pan.mp4","fps":60,"max_seconds":30}
{"action":"status","path":"map-pan.mp4"}
{"action":"stop","path":"map-pan.mp4"}
```

`start` returns after recording begins, so navigation can continue through MCP or
normal pointer/keyboard input. Use the same path for status/stop. Stop waits for
MP4 finalization and is repeatable; only `state:complete` establishes success.
Completed MCP results include a `video/mp4` resource link and a canonical local
path/URI, byte count, dimensions, requested frame rate and recorded duration.
Video bytes are not embedded in model context. Playback depends on the client;
the local path remains available when resource links are unsupported.

Paths must end in `.mp4` and stay within the MCP root. The parent folder must
exist. Files are encoded privately and atomically published without replacing an
existing output; there is no overwrite option. One recording may run per app.
The default is 60 requested FPS and 30 seconds, with 15–60 FPS, 1–120 seconds,
1920×1080 maximum output, and a 256 MiB output limit. Duration/size limits stop
capture automatically. The app remembers metadata for the last eight recordings
in the current session; completed files remain on disk across app restarts.
After a request timeout inspect status before retrying start. Capture timing is
variable; requested FPS is not a guarantee that every display refresh is encoded.

See [live MCP automation and interactive results](MCP-LIVE.md) for synchronized
performance traces, readiness, playback controls, saved navigation recipes,
resource subscriptions and the external MCP Apps result viewer.

`view_set.display` patches current display fields rather than resetting unrelated options; null resets overrides. Repeating the current mode preserves the camera. Changing mode or `fit:true` requests a new fit. Globe's `globe_time` and `globe_time_scale`, polygon `display.show_centroids`, native `gis_table` and `table_open` are shared CLI/MCP options.

`view_set {"playback_fade":false}` retains playback history in a growing time window until the next loop. `true` (the default for older scenes) uses the moving window and 0.8-second departing afterimages; entering markers fade over 0.18 seconds. This choice persists in scenes, named views and portable workspaces. Retained Events remain in the ordinary exact filtered scope and rendering budgets; the setting does not start playback. `time_height:0` flattens Space-time and persists as zero. The Globe UI also uses slider zero for Off, while the compatible agent contract remains `globe_time:false` and a separate positive `globe_time_scale` (0.05–20).



## Event terminology

The record concept is **Event** throughout the UI, code and agent descriptions. Command names such as `events`, `query`, `attribute_table` and `display_data` are unchanged. Display bins now return `event_bounds` (formerly `observation_bounds`), and `capabilities` returns `max_events` (formerly `max_observations`). Clients that hard-code the old output keys must update; rediscover the current tool schemas. Reading serialized display bins still accepts the old bounds key, without changing coordinates.

Saved workspace formats remain unchanged. Recovery accepts both the new `events.sqlite` filename and the older `observations.sqlite` filename. Import detection still accepts legacy source headers such as `observationDate` and `observationTime`; original source attributes and labels are never renamed automatically.

## Live desktop connection

Enable desktop access once with **Preferences → Enable SI agent access**, or from the command line:

```sh
chronoscope agent enable
chronoscope agent status
chronoscope agent config
chronoscope --attach call snapshot --args '{"compact":true}'
chronoscope mcp --attach
```

No folder is required. The private `agent-files` exchange folder under app data is the default file scope; an optional `agent enable --root /absolute/studies` grants file access there instead. Access to the live workspace is independent of the original CSV location. `agent disable` revokes access and persists that choice. Access is initially off; an enabled choice survives app restarts. If the app is closed, enable reports `pending:true`; open Chronoscope to start access. The desktop polls a same-user private settings file, not a separate listening control server.

The **bundled desktop executable also runs every CLI/MCP command**. On macOS you can use the executable inside `Chronoscope.app/Contents/MacOS` directly. No separate CLI installation, shell PATH change or admin rights are needed. Preferences → **MCP setup** shows the actual executable path, copyable JSON and a `codex mcp add chronoscope -- ... mcp --attach` command, with proper quoting for spaces/apostrophes. `agent config` includes the exact data-directory argument so custom app data also works. Use a client that supports launching local stdio servers. Client versions and policy may require restarting/reconnecting after configuration.

`agent status` returns enabled/connected/pending, effective scope, exchange folder and client configuration, never bearer credentials. It probes with a one-second deadline. `--attach` works globally, before or after the subcommand; existing `--connect DESCRIPTOR` remains available. Attached CLI calls do not create an unrelated demo/working database. Agent access cannot be enabled by an untrusted MCP request; enabling is a local CLI or GUI action.

For custom app data locations, use `--data-dir DIR mcp --attach`, or `--connect /path/to/agent-connection.json mcp --attach`. The GUI's selected root governs attached tools. Client support varies: a ChatGPT/Codex configuration must support launching local stdio servers; a remote-only connector cannot reach this local service by itself.

## Standalone MCP

```sh
chronoscope --project study.chronoscope mcp --root /absolute/path/to/studies
```

Without `--project`, the server starts with clearly labeled synthetic data. A standalone process owns its workspace; use saved files to exchange work with another process. `--data-dir DIR` isolates preferences/cache. An operator-specified startup project is explicitly loaded; subsequent file operations remain root-scoped. Relative tool paths resolve against the canonical root. Symlink escapes and out-of-root terrain loads are rejected; validated embedded DTED can be read from the extraction directory.

The server supports MCP initialization/version negotiation, ping, tools/list and tools/call, resources/list/read, prompts/list/get, progress and cooperative cancellation. Standalone stdio calls can emit progress notifications; attached long operations expose progress through job status. Discover tools rather than hard-coding their count. Resources are `chronoscope://workspace`, `chronoscope://schema`, `chronoscope://capabilities`, and `chronoscope://connection`. The connection resource reports the effective file root without credentials; relative file paths resolve within it. The `investigate` prompt describes an evidence-based workflow.

Stdout contains only newline-delimited JSON-RPC. Requests are limited to 4 MiB; malformed/oversized lines return an error and the server continues at the next line. There are at most 64 queued requests. Standalone execution preserves request order. Call arguments and nested filters, mappings, edits, scenes and analysis parameters are validated; unsupported keys/types are errors. Successful calls return a brief text summary and structuredContent. Key query/analysis/snapshot results have typed output schemas. Tool failures return `isError:true` and `structuredContent.error.{code,message}`. Stable codes include `INVALID_ARGUMENT`, `CONFLICT`, `SCOPE_DENIED`, `NOT_FOUND`, `RESOURCE_LIMIT`, `CANCELLED`, `UNAVAILABLE` and `OPERATION_FAILED`.

Tool response metadata is bounded to 4 MiB. Raster tools omit data URLs by default; use `include_data:true` with small tile requests if bytes are required. Canvas capture uses an MCP image block. No arbitrary SQL, scripts or shell execution is exposed. Scoped MCP writes accept .chronoscope/.json for save, .csv for export (including asynchronous jobs), and .mp4 for native window recording; unrelated file types are rejected.

## CLI automation

```sh
chronoscope import events.csv --output study.chronoscope
chronoscope import events.xlsx --sheet 1 --mapping mapping.json --output excel.chronoscope
chronoscope --project study.chronoscope --json call query --args-file query.json
chronoscope --project study.chronoscope call edit --args '{"id":"1","changes":{"note":"Reviewed"},"dry_run":true}'
chronoscope --project study.chronoscope batch --file operations.json --output revised.chronoscope
chronoscope --project study.chronoscope session --save revised.chronoscope
chronoscope --connect /path/to/agent-connection.json call snapshot --args '{"compact":true}'
```

`call --args-file -` reads JSON from stdin; files/stdin are capped at 4 MiB. `--json` uses `{ok:true,result}` or `{ok:false,error:{code,message}}`. Error exit codes are 2 invalid arguments, 3 conflict, 4 scope denial, 5 cancellation, 6 resource budget, 7 not found, and 1 other failures. Help/version use normal CLI output. Unix shell examples use single-quoted JSON; Windows quoting differs.

Single CLI invocations have independent sessions. `--project` loads one, and `call --output` saves changes. Pending imports **cannot** be carried between separate invocations. The dedicated `import` command handles preview/commit/save in one process. A persistent `session` accepts NDJSON `{id,command,args}` and returns one `{ok,id,result/error}` envelope per line, preserving import tickets, selections, undo and jobs. Bad requests do not kill the session. Its exit status reflects transport/session failure; individual operation failures are in the envelopes. Do not exit the session before a background job completes. Job handles require a persistent session, MCP, or an attached desktop.

## Safe mutations and atomic batches

Obtain `revision`/`snapshot`, preview changes with `dry_run:true`, then use `expected_revision` to reject stale edits. `idempotency_key` replays an identical successful request; reuse with different arguments is a conflict. This is a bounded **session cache** (128 entries, results up to 1 MiB), not a durable cross-restart guarantee. Retain saved work and inspect revisions after reconnecting. Mutation controls belong inside the command's arguments, not on the RPC/session envelope.

For workspace edits/selections/filters/context, dry-run executes validation under a savepoint and rolls it back. For external I/O, imports, terrain, undo and redo, dry-run returns an explicit plan with `executed:false`; it does not read, validate, write or apply that operation. Do not treat an external plan as a completed validation.

```json
{
  "operations": [
    {"command":"select_query","args":{"filter":{"predicates":[{"field":"category","op":"Equals","value":"Incident"}]}}},
    {"command":"tag","args":{"value":"reviewed"}},
    {"command":"edit_many","args":{"ids":["1","2"],"changes":{"note":"Checked"}}}
  ],
  "expected_revision": 12,
  "idempotency_key": "review-pass-1"
}
```

Pass this to `batch`. At most 100 related workspace operations execute as one revision and one undo entry. Any failure rolls back data and context. Nested batches, nested mutation controls, I/O, imports and history operations are excluded. Individual edit_many calls support up to 10,000 IDs. Normal selection/filter/camera navigation does not consume data undo. History retains at most 32 edit/context frames, bounded context memory and disk journals; up to three replacement stores support import/open undo. Saving excludes unsaved undo and deleted payload remnants from the portable database.

## Exact queries and bounded context

Sidebar column choices are portable filters: `facet_fields` maps `entity` and/or `category` to a canonical field or `attribute:<exact name>`, and `facet_hidden` maps either list to values to hide. The lists group records without changing canonical entity/track identities. For example, `filter {"filter":{"facet_fields":{"entity":"attribute:status"},"facet_hidden":{"entity":["EX"]}}}` hides EX records. Send a complete intended filter or merge it with the current filter first, as with other filter fields. A full `snapshot` (`compact:false`, since CLI/MCP defaults to compact) returns `snapshot.facets` with full-dataset counts, selected-record counts, and an explicit `limited` flag for alternate columns. Missing and empty field values share the empty-string group. Each list retains at most 5,000 values / 2 MiB; use ordinary attribute predicates for values beyond the list. The selected space-time axis uses the filter start/end (or study bounds for unbounded endpoints); source timestamps and canonical entity identities stay unchanged.

Use `dataset_schema` to discover canonical fields and source attribute names. `query` respects workspace filters by default, or accepts an independent `filter`. `attribute_table` defaults to all records, optionally scoped to a source and `apply_filter:true`.

```json
{
  "filter": {
    "start":1735689600,"end":1735776000,
    "bounds":{"west":-80,"south":43,"east":-79,"north":44},
    "predicates":[{"field":"magnitude","op":"Greater","value":"2"}]
  },
  "sort_by":"time","limit":100,
  "fields":["id","entity","time","lat","lon","attribute:magnitude"]
}
```

Preview text is bounded and marked sample-only; source data remains complete. Projection avoids loading unrelated source payloads. Numeric attribute sorting uses `sort_by:"attribute:column name"`; predicate fields accept canonical names or explicit `attribute:column name`. Bare original names remain aliases when they do not collide with a canonical name. Supported operators are Contains, Equals, NotEquals, Greater, Less and IsEmpty. Filters combine with AND. Bounds support antimeridian crossings in backend queries; WMTS display bounds do not.

Responses include exact count, offset/limit, rows and `next_cursor`. Pass the cursor with the same filter/source/sort/direction. Cursors bind the working dataset, data revision, effective filter/order and (when used) selection revision. They reject stale data/query reuse; camera navigation does not invalidate event paging. Pages contain at most 1000 rows and 4 MiB of payload; narrow fields/limit for wide records. Attribute-table column discovery is cached and bounded to 512 original columns.

`aggregate` computes exact count/numeric_count/min/max/mean/sum over all matching records, grouped by entity, category, source, UTC hour/day/month, or `attribute:column`. Numeric fields are value, lat, lon or `attribute:column`. Group outputs are limited to 1000 and disclose `limited`.

`select_query`/`select_visible` select all exact backend matches, including unlocated and undisplayed events. `selection_contains` checks exact IDs without transferring an entire large selection. Snapshots return selection counts and a bounded list; saved view/group identity lists are similarly bounded and disclose counts/limits. Exact sets remain in the backend and portable workspace.

## Long operations

Start `job_start` with `{command,arguments}`, then poll `job_status`, fetch `job_result`, and release it with `job_release`. Long-job commands include open, import_preview/validate/commit, gis_load, gis_import_preview, query, aggregate, analyze, save and export. Nested command schemas, file scopes and mutation controls still apply. `job_cancel` signals cooperative interruption. Status/result/cancel are available while an operation owns the workspace gate.

There are at most 16 queued/running jobs, 64 retained handles, 4 MiB per result and 8 MiB retained results. Completed handles are evicted when the registry fills; release results promptly. Jobs and results are session-local. Workspace operations serialize for revision safety; the canvas can still orbit/zoom using its existing packet while a worker runs.

For synchronous stdio calls, put `_meta.progressToken` in tools/call params. Cancel with `notifications/cancelled` and the original `requestId`. CSV/SQLite/analysis loops check cancellation; WMTS checks between requests. A currently blocked OS/network operation may finish before interruption is noticed. Workspace savepoints roll back interrupted edits. An already completed atomic file write is not reversed; inspect the file/revision after interrupted external I/O. Cancellation does not mean an operation never started.

## Import, terrain and maps

`import_preview` returns an `import_id`, headers/sample, mapping, notes and warnings. MCP requires the ticket for import_validate/commit, including nested job commands; GUI and dedicated CLI import also pass it. Legacy single-client domain sessions retain a most-recent-ticket fallback. Four pending tickets are retained, with at most one full Excel workbook and byte-bounded CSV samples; file size/mtime changes require a new preview. CSV conversion streams 1000-row batches into a staged database; rejected rows require explicit `accept_rejected:true` and never silently replace the current study. Excel remains bounded workbook ingestion. Mapping supports DD/UTM/MGRS, combined/separate dates/clocks, explicit date order, epochs, Excel date systems, timezone offset, default date and decimal commas. Seconds/fractions are retained as binary64 Unix seconds (about 0.24 microsecond spacing near 2026); UTM zone/hemisphere are not invented; short MGRS uses grid centres without suffix-zero padding.

```sh
chronoscope coordinates --input '{"system":"mgrs","reference":"18T WL 8566 1131"}'
chronoscope terrain tests/fixtures/terrain --sample=43.5,-79.5
chronoscope wmts 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml' \
  --layer BlueMarble_ShadedRelief --matrix-set GoogleMapsCompatible_Level8 --bounds=-80,43,-79,44
```

Planning does not fetch raster tiles. Add `--fetch` only when necessary. Tile requests use concurrent direct disk-cached access with no imposed delay by default. `wmts_plan_page` pages full requested coverage; `wmts_rasters` accepts offset/limit and returns total_tiles/next_offset. Configurable pacing is for optional restraint; HTTP rate-limit cooldowns are respected without retries. Terrain mesh resolutions are 8–257; elevations are DTED metres MSL. Portable workspaces embed DTED and display/map settings in version-6 ZIP or indexed SQLite v3 under `.chronoscope`; large legacy JSON is not supported.

## Limits and diagnostics

CSV: 2 GiB file, 1 MiB logical record, 512 columns, 50 million event budget; the tested scale is **one million**, not a promise of interactive performance at the maximum. Database open budget: 32 GiB. Work/undo/backup/journals need several times the stored dataset size in free space. Excel: 64 MiB file, 256 MiB expanded, four million cells, 250k rows. Terrain: 32 MiB per embedded tile, 512 MiB total. Pattern analysis defaults to 200k input events (explicit override up to one million), plus dense candidate/finding budgets; always inspect input_limited/evaluated_count/limited. Backend query/aggregate/selection are exact; rendering defaults to 20k representative points and reports LOD. Up to a quarter of a bounded packet (maximum 5000) is reserved for selected visible evidence so table/agent selections are represented; larger selections remain explicitly sampled.

`diagnostics` returns revision, storage/cache health and log location. Logs rotate at 2 MiB across five files and record command, revision, duration and success without event fields, arguments, tokens or file paths. This is triage logging, not a complete audit/recovery system. Autosave/crash recovery, remote authenticated hosting, durable jobs/idempotency, global terrain/imagery streaming, hardware-GPU/native Mac/Windows runtime certification and broader feature parity remain separate work.

## GIS numerical contract

All inputs are WGS84, not arbitrary datum/CRS transformations. Coordinate results include grid_system and grid_crs (EPSG identifier); the legacy utm object uses zone 0 for UPS. Longitude +180 normalises to -180, the same meridian. Negative zero latitude is northern at the equator. Short MGRS returns cell centres and cell-size metadata. Proximity/stationary/speed use WGS84 ellipsoidal geodesics. WMTS accepts exact recognised EPSG:3857/900913, EPSG:4326 and OGC CRS84 identifiers, respecting their axis order; unsupported CRSs are rejected. DTED must declare WGS84 and MSL; unknown datums are rejected. terrain_sample returns source MSL metres, not ellipsoidal height. See [independent GIS validation](GIS-ACCURACY.md).

## WMTS smartcard / client-certificate authentication

Native macOS/Windows TLS automatically selects client certificates when a WMTS server requests them. PIN prompts belong to the OS/card provider. No per-server configuration is required by default. `wmts_auth_status`, `wmts_auth_set`, `wmts_auth_remove` and `wmts_auth_reset` are shared CLI/MCP operations; optional overrides stay local and never enter a portable workspace. Linux currently needs a PKCS#11 URI and compatible installed curl/middleware. See [WMTS authentication](WMTS-AUTH.md) for schemas, origin isolation, headless behavior, cache persistence and hardware-testing limits.

## Built-in assistant and time/proximity summaries (0.6)

See [SI and aggregation](SI-AGGREGATION.md) for all commands, privacy/protocol limits, session-key lifetime, bounded tool execution, scope rules and grouping semantics. `si_run`, `space_time_aggregate` and `aggregate_apply` support asynchronous jobs. The assistant consumes the same MCP tool schemas and shared engine operations; it never shells out. `si_configure` keys remain in the current engine's memory, so configure/run must share a persistent session or attached desktop.

`import_commit` optionally accepts `aggregation:{window_minutes:15,radius_m:100}`; its response distinguishes accepted raw rows and retained summaries/records. `space_time_aggregate` previews exact group counts over all matching rows. `aggregate_apply` replaces the entire workspace with summaries of the matching records and excludes other rows/context, so preview, save the original and guard with `expected_revision` first. Missing locations remain separate.

`render_data` additionally returns `inferred_ids`, `inferred_markers` (exact before/after IDs, times, fraction and method), and `unlocated_count`. Packed positions for inferred IDs are display estimates only; the source coordinates remain null. Never feed these positions into evidence analysis or exports as observed locations. `located_count` counts measured points and explicitly derived polygon-centroid anchors; inferred time-only triangle positions remain excluded.


## Map cache and WKT (0.7)

`wmts_access` reads local settings/cache usage. With `settings`, it merges concurrency (1–32), request_interval_ms (0 by default), cache_limit_mb (8192 default, 0 unlimited), tile_ttl_days (30 default) and offline (false) into local configuration. `wmts_cache_clear` removes cached resources. Neither uses a proxy or separate server. `wmts_plan_page` supports offset/limit (up to 4096) and target_pixels for automatic resolution; a chosen config.level/index is honored. `wmts_rasters` defaults to 16 tiles per response, **not per viewport**; continue using next_offset until null. Image response/IPC limits still apply; agent responses omit image data unless include_data is true.

Import mapping accepts geometry_wkt: a source column index. Canonical geometry_wkt is original WKT text, queryable/exportable/editable; edits revalidate and update derived POINT lat/lon or derive polygon-centroid anchors while retaining full geometry; other non-point shapes keep null scalar coordinates. Changing scalar point coordinates detaches the old WKT geometry. `render_geometries` accepts filters/source/offset/limit/max_vertices and reports bounded features, total count, limited, vertex_count and bounds. POINT geometry is already in render_data; other types are returned separately. Geographic bounds use true geometry intersection, including polygon holes. Full protocol/CRS/type limits are in [Map cache and WKT](MAPS-WKT.md).

## Version 0.8 contracts and workspace lifecycle

`chronoscope schema` returns the complete registry, per-command input/output schemas and stable error-code enumeration. Command-specific schema discovery remains available. Output schemas are checked on MCP responses. Resource/render contracts derive from serialized Rust DTOs; the frontend contract is generated, with exact string IDs throughout saved groups, views and render packets. Jobs and batches validate their nested command/arguments before execution; batch excludes I/O/history and nested mutation controls.

`workspace_status` reports `dirty`, source path and checkpoint/recovery state. `recovery_checkpoint` explicitly checkpoints local unsaved data without a portable full copy. Recovery listing/restoration/deletion/clearing is a local GUI/direct-CLI facility, excluded from MCP and assistant tools so an attached agent cannot recover another session outside its filesystem scope. Use normal `save` to create a portable deliverable. Automatic document saving is enabled by default: the GUI writes local copies every 30 seconds and before leaving a workspace, and archives abandoned checkpoints without prompting. Preferences can restore manual prompts. The host-only `autosave_unsaved` and `recovery_archive` commands write only to the managed document folder and remain excluded from inbound MCP. `workspace_status` reports `document_directory`, `autosave_path`, `autosave_revision`, and `auto_save_unsaved`.

`render_data` and `render_geometries` accept viewport `bounds` and `expected_revision`; the viewport intersects current semantic filters. This refines representative visuals without changing exact query semantics. `snapshot` accepts `include_statistics:false` to skip statistics; the GUI requests them when Charts is shown. Analysis discloses `candidate_visits`, bounded even for dense same-entity data.

`job_start` supports paged `wmts_rasters` and `terrain_mesh` alongside existing long tasks. GUI raster pages use eight tiles and one progressive viewport texture. Raster job result payloads are limited to 8 MiB (ordinary results 4 MiB), with 16 MiB total retained results. Direct raster pages have a 7 MiB data budget and return continuation offsets. MCP raster/job responses strip image data by default; request `include_data:true` only when required and keep its 4 MiB transport envelope limit in mind. Release completed jobs promptly. Queued workspace jobs and Rust HTTP requests check cooperative cancellation while waiting; external OS/card calls can still take longer.

`EngineError`/`ErrorCode` provide stable transport codes. Explicit error prefixes take precedence over legacy internal message classification. Internal helpers still include String errors; this is not a promise that arbitrary OS messages map to a precise domain category. See the schema error enumeration instead of parsing human-readable text.


## Version 0.9 performance and outcome contracts

`events` supports requested scalar fields without unrelated source payload decoding. `attribute_table` accepts `column_offset` and `column_limit` (1–32) to page original columns; these cannot be combined with explicit fields. The response reports `total_columns`, `column_offset` and its current columns. Exact string IDs remain present. Legacy calls without a window retain their behavior.

`view_set` accepts scene `render_budget` of 20000 or 100000. It changes representative display density, not exact query, selection or analysis results. `terrain_mesh` returns `cache_hit`; `decoded_tiles` is zero when the complete mesh was reused. The private `view_snapshot_v1` GUI command is excluded from public MCP discovery.

Jobs retain existing bounds and add structured `progress_event` fields (`phase`, `completed`, `total`, `unit`, `sequence`). Sequence numbers increase within an operation. Successful mutations and external file commits return a bounded `commit_receipt` containing an opaque operation/store identity and revisions. A receipt retained on a job can establish that an output committed even if its larger result could not be retained. After cancellation, inspect terminal status and receipt before retrying a write; cancellation racing after atomic replacement cannot undo that replacement. Registries and receipts remain session-local, not a durable cross-restart transaction service.


## Named WMTS servers (0.10)

`wmts_servers` returns `servers` (the editable local library) and `presets` (bundled connections with coverage, license and credit links). Built-ins are read-only metadata available offline; copy a preset’s id/name/config into settings.servers to save it. The built-in list is never written into the user library automatically. Replace it with `{"settings":{"servers":[{"id":"organization","name":"Organization imagery","config":{"url":"https://maps.example.org/wmts","layer":"imagery","matrix_set":"grid","style":"default","format":"image/png","time":"","enabled":true,"level":null}}]}}`. IDs must be unique, 1–64 ASCII letters/digits/hyphens/underscores; names are 1–128 characters, with at most 32 servers and a 1 MiB library. Settings writes are validated and atomic. This tool accurately advertises that it can mutate local settings. Library updates do not change workspace layers: use `preferences.map_layers` for multiple enabled sources with opacity/order/zoom rules, or legacy `preferences.map` for one source. See [map layers](MAP-LAYERS.md). Use `wmts_capabilities` to discover layer/matrix/style/time options instead of inventing identifiers. The library is independent of portable workspaces and survives opening another project.


## Outbound client

Chronoscope is also an MCP **client**, independently of the stdio server described above. See [MCP client setup and limits](MCP-CLIENT.md). `client_status`, `client_tools` and `client_call` are public tools; connection setup, tool grants and disconnection are local host controls available through GUI/CLI but not advertised or callable by inbound MCP, including through background jobs. SI receives only explicitly granted namespaced external tools, not these management controls.

Use `--attach` or a persistent `session` for connection setup/calls; a one-shot process loses its in-memory connections on exit. `chronoscope --attach ask "Read the connected data service"` can use granted query tools. `--allow-external-actions` permits already-granted action tools for that request; `--allow-edits` separately permits record edits. Explicit `client_call` action invocations require `allow_actions:true` and a matching reviewed fingerprint. File roots and Undo apply to Chronoscope operations, not external services. Never assume that retrying an interrupted external action is safe.

## Exact attribute-table range selection

`select_query` accepts `table_range: {"anchor":"exact-id", "target":"exact-id", "sort_by":"time", "descending":false}` with the usual `source`, `apply_filter`, `filter`, `display_cell` and selection `mode`. Both endpoints must exist in the chosen table scope. The inclusive range uses the same stable ordering as the attribute table, crosses pages without sending row payloads, and preserves exact unsigned 64-bit IDs. It can replace or add to the current selection.


## Globe time elevation (CesiumJS)

`view_set` accepts `globe_time` (boolean, default false) and `globe_time_scale` (0.05–20, default 1; independent of Space-time `time_height`). For example, `chronoscope --attach call view_set --args '{"mode":"globe","globe_time":true,"globe_time_scale":1,"fit":true}'` enables it and fits the view. In stdio MCP, call `chronoscope_view_set` with the same arguments. These fields also persist through `scene_sync`, named views and portable workspaces. Older workspaces default to surface events.

The default maximum time offset is 12% of study extent, capped at 50 km. The logarithmic Globe slider multiplies this by `globe_time_scale` and displays the resulting maximum offset in metres/kilometres. Smaller studies get a proportionally smaller default. UTC time maps to display elevation along the WGS84 surface normal above local terrain. This does not change source coordinates, timestamps or physical heights. Heat/bloom/density rasters stay on the ground. Globe time clusters retain UTC slabs; event/cell budgets remain bounded. Ground-footprint culling is disabled for elevated Globe events so an event visible above the horizon is not dropped because its ground location is off screen. The legend now defaults to a 210-pixel panel, wraps long entity labels and remains collapsible/resizable within a narrow width.

## Native GIS operations (Chronoscope 0.14)

See [GIS file workflows](GIS-FILES.md#cli-and-mcp). `file_probe` distinguishes workspace JSON from GIS; `gis_load` adds local GeoJSON/TopoJSON/KML/KMZ/CZML/GPX/3D Tiles/glTF/GLB. `gis_layers`, `gis_set`, `gis_remove`, bounded `gis_table` and chunked `gis_read` expose the same reference layers as desktop. `gis_import_preview` prepares a standard import ticket from a packaged source, even when its original files are absent. `gis_table.feature_id` links a native object to source samples. `view_set {"gis_table":"LAYER_ID","table_open":true}` opens its table. Use source bounds with ordinary `view_set` to frame a study; model placement is explicit WGS84 longitude/latitude/ellipsoidal height. Jobs support `gis_load` and `gis_import_preview`.

Event `location_kind: "polygon-centroid"` means scalar coordinates are a derived surface centroid, not a measured source point. `render_data.centroid_ids` labels these in the bounded packet. Original polygons remain available through `render_geometries`, WKT and source attributes. Exact spatial filters still use full polygon intersection; point-based analyses/display grids use the centroid. `display.show_centroids` defaults true and controls marker/track visibility separately from retained geometry. CSV exports also identify the derived location kind.

GIS `gis_table` responses include `returned_count`, `next_offset` and `revision`. Follow `next_offset` rather than adding the requested limit: large source properties can shorten a byte-bounded page. Supply `expected_revision` on subsequent pages for consistent traversal. `gis_set.selected` accepts exact source feature IDs from the table and rejects unknown IDs; native multipart objects remain associated with that source ID.

## Focused analysis assistance and Apple Intelligence

All platforms expose the following shared operations through `call` and matching `chronoscope_*` MCP tools:

- `analysis_context {scope:"visible"|"selected"}` computes exact compact eligibility for Gaps, Speed, Stationary, Proximity and Clusters. It reads all matches, without sending raw records to an LLM. Selected scope intersects current filters. Eligibility is a prerequisite check, not a guarantee of findings.
- `analysis_prepare {pattern,scope,parameters}` validates explicit thresholds and returns `{revision,pattern,scope,parameters}` for review. It does not execute the analysis. Units are seconds, metres and track speed in km/h.
- `analysis_execute {plan}` revalidates a reviewed plan and rejects stale revisions. It returns the standard analysis report, capped at 200,000 evaluated events and 10 returned findings. Check `input_count`, `evaluated_count`, `input_limited`, `count` and `limited`. Larger investigations can use the existing `analyze` operation with its explicit budgets. `job_start` supports `analysis_execute`.
- `si_apple_status {}` checks actual on-device readiness on macOS 26+, or reports an unsupported platform. It does not enable Apple Intelligence or change OS settings.

```sh
chronoscope --attach call analysis_context --args '{"scope":"selected"}'
chronoscope --attach call analysis_prepare --args '{"pattern":"Gaps","scope":"visible","parameters":{"gap_s":21600}}'
chronoscope --attach call si_apple_status
chronoscope --attach call si_configure --args '{"url":"https://api.openai.com/v1","model":"YOUR_TOOL_CAPABLE_MODEL"}'
chronoscope --attach ask 'Recommend analyses for this scope'
chronoscope --attach ask 'Find gaps longer than 6 hours'
```

To execute a plan, copy the reviewed result into `{"plan":{...}}` and pass it to `call analysis_execute --args-file reviewed-plan.json`, using the returned plan. Do not use `call --output` to write a plan: that flag saves the workspace. Configure and ask within one persistent `session`/MCP connection or attach to the desktop; independent standalone CLI processes do not share SI connections.

`si_configure` accepts only `provider:"openai-compatible"` (the default) and requires a service URL and model. Apple Intelligence is retired from SI Chat, including CLI/MCP configuration; `provider:"apple-local"` is rejected. Previously saved Apple chat preferences are treated as unconfigured. Configure and connect a model service explicitly. API keys remain in session memory, and granted external tools retain their existing permission checks. `si_apple_status` remains a readiness diagnostic and does not connect a chat model. Focused explanations and reviewed tag suggestions have their own `assist_*` commands and explicit provider choice; see [focused AI assistance](APPLE-SI-ANALYTICS.md).

SI conversation history retains at most 32 messages/98,304 bytes, with explicit excerpts for long messages. The existing tool loop, cancellation, per-message edit permissions and external-action permissions continue to apply to connected model services. Completed actions remain after cancellation.

macOS App Intents expose workspace summary, view switching, additive entity selection/deselection, analysis recommendations and gap analysis. They run the same engine commands with typed parameters and require local device authentication. The built bundle contains compiled Swift intent code and `Metadata.appintents`; CLI builds alone do not register Siri actions. App Intents do not embed Siri inside SI or grant direct PCC access. The unsigned/ad hoc build exposes the actions but macOS rejects execution on the test Mac because it cannot obtain an Apple signing team ID. System handoff needs an Apple team signing identity; local Apple Intelligence and CLI/MCP do not.

The 2026-10-17 coverage audit confirmed existing selection `add/subtract/toggle`, scene/display controls, appearance preferences and live renderer status remain available through their shared commands. The renderer status placement and SI gear hierarchy are UI presentation changes. MCP roots are normalized in embedded calls as well as standalone serving, so macOS `/var` aliases retain the same narrower SI file scope.

## Map navigation input

Globe, space-time and 2D Map share pointer-anchored wheel/right-drag zoom and left/right double-click zoom. Middle-drag or Ctrl/Shift-left-drag rotates/tilts 3D views; Select mode retains additive left-drag boxes. Shift-wheel tilts, Ctrl/Cmd-wheel rotates and Alt/Option-wheel makes finer zoom steps. 2D stays north-up. Keyboard camera navigation applies only within the map, leaving table, time-slider and field shortcuts intact. There is no camera inertia, automatic zoom-induced tilt or free-look. Gesture tilt is limited to 85 degrees and camera movement stays above the geographic floor. Space remains timeline play/pause.

The existing `view_navigate` actions and zoom-factor range remain supported; no new MCP tools are required for these input bindings. `view_status.diagnostics.navigation` reports inertia/free-look policy, north-up-only state, gesture tilt limit and active pointer state. Exact camera restoration and explicit geographic `look_at` remain separate from gesture bindings.

## Default basemap

The single built-in map is OpenFreeMap Positron, named Streets. Use the shared `preferences` command with `{"preferences":{"basemap":"streets"}}` or `"none"`. This is independent of `preferences.map_layers`, which retains custom WMTS overlays. Existing overlays can cover the basemap; disable those overlays explicitly when requesting Streets only. The value persists in saved projects. `wmts_servers.presets` is now empty; named user servers remain supported. Live view diagnostics report pending/error/tile-alignment status for Streets.

### Display feedback and renderer recovery

Time elevation places the newest events at ground level and the oldest events at the top in Space-time and optional Globe time elevation. The horizontal time window still runs from oldest to newest; source timestamps are unchanged. A single timestamp has no time elevation.

Heat map and bloom both overlay the Events layer in every map view. `display.show_points` independently controls event markers. New display defaults use `track_opacity:0.25` and `trail_opacity:0.25`; existing saved strengths are retained. Views sliders preview during input and persist the final value after a gesture. Effect generation coalesces pending input, retaining the preceding ground image while its replacement renders.

The renderer indicator beside Notifications can refresh all map graphics while retaining workspace data, selection, camera and resources. An unexpected render failure triggers one automatic recovery. `view_status.diagnostics.lastRenderError` retains the most recent renderer stack for diagnosis, while `renderErrorCount` counts errors in the current graphics session. A warning remaining after automatic recovery can be retried by clicking the indicator.

## Entity-preserving visual clusters

`view_set.display.mode` values `auto` and `clusters` now group visual clusters within each entity and preserve its palette/custom color; counts determine size and labels. Cluster selection uses an outline rather than replacing the fill color. `show_tracks`, `show_trails`, and their opacity settings remain independent of clustering. Underlying observations remain subject to the configured render budget and existing line simplification limits. If separate entities exceed the 4,000-cell budget, the view uses bounded event markers instead of merging their identities or failing the scene.

The GUI no longer exposes mixed-entity cluster partitions. The public `display_data.partition` query still accepts `all`, `entity`, and `source` for exact summaries and cell membership. Heat, bloom, and density retain their combined-count presentation.

## Rich result presentation

`chronoscope_present_result` presents an existing analytic result as an inline card/chart/table, or captures the live map into a bounded inline image. It returns a typed reference while the data/image stays in Rust. SI chat session-management endpoints are private UI commands and are not advertised to models. See [rich chat and presentation contracts](SI-RICH-CHAT.md).

### Statistical pattern screening

`pattern_scan` is a read-only, detached, cancellable operation. Call it with an optional `config` containing `scope` (`visible` or `selected`), up to eight explicit `fields`, `minimum_records` (default 20), `correlation_threshold` (default 0.6), and `outlier_multiplier` (default 1.5). Empty fields select Value plus up to seven eligible numeric imported columns from a bounded discovery catalog (512 names); coordinate, calendar and identifier-named imported columns are excluded automatically, but names never establish meaning. Use exact `attribute:<name>` identifiers for imported measurements. Optional `expected_revision` rejects an intervening workspace change.

The response includes `scan_id`, `revision`, `cache_hit` and a full `report`: scoped record count, inspected and distinct varying numeric fields, per-field coverage, candidate counts/denominators, exact method settings, bounded source examples, limitations and warnings. Methods include IQR outliers, exact duplicate numeric columns, missing/blank values, complete-pair Pearson relationships/time associations, source/entity recording gaps, and regular UTC count-series FFT candidates. All calculations use the declared full scope; no confirmatory p-values, causal interpretation, or inferred spatial thresholds are supplied. `cached_only:true` returns a matching cached report or `report:null` without starting an analysis. Four reports of at most 2 MiB each are held in memory for the current engine session; keys include dataset identity/data revision, full effective filter, options, and selection version when selection affects the scope. Reports are not persisted into workspace files. Use `job_start {"command":"pattern_scan","arguments":{"config":{}}}` for progress and cancellation.

`select_query {"pattern_scan_id":"…","pattern_finding_id":"…","mode":"replace"}` selects every supporting source record, up to one million, rather than the five examples. Add/subtract/toggle modes and existing mutation controls apply. Evidence cannot be combined with a chart selection, table range, display cell or separate filter. Stale data/filter/selection scope or an expired cache entry returns `CONFLICT`. The engine rebuilds exact evidence against a pinned read snapshot, then commits through the normal revision-checked selection path. Gap evidence contains both endpoints; periodicity evidence contains all observed scoped records. Scan options and field metadata disclose omissions and assumptions.

The UI calls vertical event-to-ground lines **Stems**. Existing `show_trails` and `trail_opacity` keys remain compatible in saved projects, CLI and MCP. SI exposes `chart_data` and `pattern_scan` alongside field profiles, queries, aggregates and statistical analytics. Apple SI receives a bounded inventory of currently allowed tools; empty search matches are distinguished from unavailable capabilities.

Fresh standalone CLI/MCP/server sessions start empty unless `--project PATH` is supplied. `--demo-data` explicitly seeds the small synthetic regression fixture; it cannot be combined with a project or an attached desktop connection. The desktop starts with an empty workspace. Hurricane examples are the only datasets under `samples/`; format/terrain regression inputs are under `tests/fixtures/`.


Charts exposes eight UI starters backed by the shared `chart_data` command: compare groups, change over time, distribution, relationship, compare spread, repeating patterns, composition over time and compare periods. New `kind:heatmap` uses `x:time`, `x_axis:time` (or `x:end`) and returns UTC Monday-first weekday/hour cells. New `kind:period` groups by categorical `x`; optional `period_a`/`period_b` are non-overlapping `[start,end)` arrays in fractional Unix seconds. Null windows request automatic adjacent halves of the scoped/layer time extent. The returned config resolves those windows for evidence selection. Rust returns paired rows and exact deltas/percentages, with undefined zero/missing baselines represented by null, and `outside_period_count` separately from missing values. Pass returned config, `revision` as `expected_revision`, and row `x`/`series` to `select_query`. Both kinds support scope, layer, manual measurement aggregation, persisted presets and saved views. See [Charts](CHARTS.md) for examples and interpretation.

### Document identity for delayed mutations

`snapshot.workspace_id` is an opaque, session-local document token. Supply it as `expected_workspace` on a mutation when the request may wait while the user opens another project. It complements `expected_revision`: identity prevents retargeting a different document; revision prevents applying an edit to a newer state. Reopening a file or undoing a workspace replacement invalidates earlier document tokens. Do not persist these tokens in portable projects.

SI runs and asynchronous jobs bind their document identity automatically before waiting. If the document changes, stale operations return `CONFLICT`; start a new request for the current workspace. File-root restrictions remain independent and continue to apply to imported resources, startup project files and recovery.
