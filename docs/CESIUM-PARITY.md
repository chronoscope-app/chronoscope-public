# Chronoscope CesiumJS renderer: scope and verification

Chronoscope uses the shared Rust engine, Tauri host and application controls. It replaces geographic rendering with CesiumJS **WebGL**, including the globe, top-down 2D map and Columbus-view space-time display. It does not add a second independent data model or require Cesium ion. WebGPU is outside the current renderer's scope.

The source baseline is original Chronoscope commit `74a3a59a67d2bc250169a9702335b9bf03ee03bc`. The current Chronoscope main branch contains the CesiumJS implementation.

This is a traceable inventory, not a declaration that a renderer migration has passed. A feature is verified only when a recorded local run exercises it. Existing Chronoscope screenshots and validation reports describe the original renderer unless explicitly labelled Cesium.

## Retained application contracts

| Capability | Existing implementation / visible entry point | Engine contract and existing evidence |
| --- | --- | --- |
| CSV and Excel import with editable detection | `frontend/src/main.ts` Import dialog; `#import`, `#import-sheet`, `[data-map]` | `import_preview`, `import_validate`, `import_commit`; `tests/import_workspace.rs`, `tests/performance_append.rs` |
| Combined/separate dates and clocks, fractional-second precision | Import mapping and date-order/timezone controls; original attributes retained | `src/import.rs`; `tests/import_workspace.rs`, `tests/event_terminology.rs` |
| WGS84 DD, UTM/UPS and short/spaced MGRS | Import mapping; Preferences coordinate readout | `coordinates`; `tests/gis_accuracy.rs`, `tests/geospatial.rs` |
| OGC WKT lines, polygons/holes, multipart and collections | Geometry mapping and inspector WKT editor | `render_geometries`, `edit`; `tests/wkt_wmts.rs`; raw Z/M are not display altitude/time |
| Native GIS files and polygon anchors | Unified Open: GeoJSON/TopoJSON, KML/KMZ, CZML, GPX, local 3D Tiles and glTF/GLB; explicit Events conversion | `gis_*`, portable version-5 packages; `tests/gis_files.rs`, `frontend/scripts/gis-files-qa.mjs`; [format boundaries](GIS-FILES.md) |
| Event/entity/category distinction | Sidebar metrics, search and sortable/collapsible facets | `snapshot`, `filter`, `dataset_schema`; source wording is preserved |
| Exact global and source attribute tables | `#toggle-table`, layer double-click/context menu; continuous row window, column window, left close button | `attribute_table`, `query`; `tests/table_selection.rs`, `tests/views_layers.rs` |
| Click/toggle/range selection, table ↔ scene linking | Scene selection, table Ctrl/Cmd/Shift selection, `#select-all`, `#selected-only` | `select`, `select_query`, `selection_contains`; exact string IDs and server-side inclusive ranges |
| Search, time/region/attribute/selection filters | `#search`, exact dates, range brackets, geographic bounds, attribute rules | `filter`, `query`, `render_data`, `render_geometries`, `display_data`; displayed samples do not redefine exact matches |
| Edit, reassign, tags, delete and undo/redo | Inspector fields, selection actions, Undo/Redo | `edit`, `edit_many`, `reassign`, `tag`, `delete`, `undo`, `redo`; `tests/workflows.rs`, `tests/hardening.rs` |
| Proximity, stationary, gaps, speed and clusters | Patterns inspector, finding-to-evidence selection | `analyze`; bounded input/candidate disclosures; `tests/performance_analysis.rs`, `tests/gis_accuracy.rs` |
| Charts and grouped statistics | Charts inspector | `snapshot` statistics, `aggregate`; source data remains exact |
| Lossy time/proximity aggregation | `#aggregate-events`, import aggregation option, preview before replacement | `space_time_aggregate`, `aggregate_apply`; `tests/assistant_aggregation.rs` |
| Portable workspace and embedded DTED | Open/Save/Save copy; `.chronoscope` | `open`, `save`; `tests/import_workspace.rs`, `tests/performance_persistence.rs` |
| Saved views, selection groups and display preferences | Views → Saved views; Preferences | `save_view`, `restore_view`, `save_group`, `restore_group`, `view_set`, `scene_sync`; camera conversion needs renderer-specific checks |
| Automatic local saves and crash recovery | Preferences, local recovery controls | `workspace_status`, `autosave_unsaved`, `recovery_checkpoint`; `tests/autosave.rs`, `tests/event_terminology.rs` |
| CSV export and source provenance | `#export`; original source attributes | `export`, `events`; `tests/workflows.rs` |
| Dark/light modes, tooltips, help and keyboard | `#theme`, `#help`, F1, standard desktop bindings | `frontend/src/help.ts`, `frontend/src/tooltips.ts`; visual contrast requires browser review |
| First-class CLI and inbound MCP | Bundled binary `--help`, `schema`, persistent sessions, `mcp --attach`; Preferences MCP setup | `src/cli.rs`, `src/mcp.rs`; `tests/agent_setup.rs`, `tests/agents_scale.rs`, `tests/agent_host.rs` |
| Native/live screenshot access | `#screenshot`; attached `view_capture` | MCP/CLI default to the whole visible app WebView; `target:map` and the map export button retain the attributed Cesium canvas export |
| Outbound MCP and SI chat | Preferences → Outbound MCP; SI chat setup/messages/tools | `client_*`, `si_*`; `tests/mcp_clients.rs`, `tests/assistant_aggregation.rs`; grants and credentials remain session scoped |
| Disabled browser-extension WebMCP | No exposed extension controls or commands in normal builds | `tests/webmcp_disabled.rs`, `frontend/scripts/webmcp-disabled-qa.mjs`; experimental source remains archived |
| Jobs, cancellation, schemas and mutation controls | Progress/cancel controls; agent schema discovery | `job_*`, `expected_revision`, `dry_run`, `idempotency_key`, atomic batches; `tests/performance_jobs.rs`, `tests/agents_scale.rs` |
| Privacy and local logging | Preferences, diagnostics | Rust keeps credential and file-scope enforcement; bounded logs omit event values and secrets |

## Renderer obligations

| Feature | Required Cesium behavior | Verification must observe |
| --- | --- | --- |
| Globe | WGS84 ellipsoid, geographic camera navigation, near-surface zoom | Native `SceneMode.SCENE3D`, camera movement and known coordinate projections; polar/date-line references |
| 2D map | Top-down geographic view with cursor-oriented wheel zoom | Native `SceneMode.SCENE2D`, map data visible after transitions, geographic screen anchor stability and native-frustum map zoom with terrain active |
| Space-time | Columbus-view map with timestamp-derived display height, labels, single-corner time axis, playback tick and rotation handles | Native `SceneMode.COLUMBUS_VIEW`; equal timestamps yield equal time offsets; stored coordinates/terrain heights remain untouched |
| Located and time-only events | Circle markers for measured positions; triangles for display-only interpolation | Native billboard/point objects; event picking agrees with table selection; `events` still returns null source coordinates for triangles |
| Tracks and vertical trails | Independent toggles, opacity and bounded simplification; gaps/boundaries respected | Actual native line counts/visibility and rendered output, not a synthetic Three.js-shaped adapter |
| WKT | Point, line, polygon/hole and multipart rendering; selection by shape | Native geometry with hole-aware fills where supported; shape picking and real backend IDs in every geographic mode |
| Default LOD | Automatic clustering above 2,000 matching located records; exact query data retained | Bounded packet/primitive counts, actual backend cell-level refinement and declustering on native camera zoom, exact member-table and selection results; elevated visible events retained in Columbus data bounds |
| Density | Counts per grid cell, visible on map/terrain | Native colored geometry or imagery; no claim of probability or area-normalized density |
| Heat map | One-click automatic parameters, weighted kernels, off by default | Visible native ground overlay; time height changes do not lift it; nodata holes and asynchronous stale-result disposal |
| Bloom | Off by default; ground emission only, with map/elevated objects excluded | Pixel comparison and ground emission resources; toggling must not brighten unrelated imagery or leave red/full-screen residue |
| Playback | Smooth focus progression and bounded in-flight refresh; no geographic reframing | Repeated frame times, focus and point opacity changes; paused queries contain only current records |
| Multiple WMTS sources | Layer order/opacity/enable/zoom windows, provider choices and attribution | Real imagery collection/provider coverage; imagery retained during camera/mode/event updates; disabled sources stop requesting tiles |
| Native WMTS authentication/cache | Rust direct transport, native client certificates and cache/offline policies reused | Cesium must consume Rust raster packets without bypassing origin policies or sending client credentials to browser providers |
| DTED | File/folder load; holes retained; map draped over relief, adjustable display exaggeration | Native terrain provider; independent sample comparison, provider availability and resource retention in map/globe/space-time |
| Terrain datum | MSL source is not silently presented as ellipsoidal height | Explicit vertical-datum choice/status; any geoid conversion has independent numerical fixtures; no invented elevations at missing cells |
| Camera persistence | Save/restore camera in all modes | Native camera/scene state round-trip; older Three camera state has a documented conversion/fallback rather than being treated as native ECEF |
| Screenshots and lifecycle | Same visible scene captured; resize/theme/context cleanup | Decodable nonblank canvas PNG, credits, no stale overlays or WebGL errors after repeated mode/workspace changes |

## Test migration

The inherited Rust tests and renderer-independent `filter-intent-test.mjs`, `packet-test.mjs` and `display-math-test.mjs` remain useful unchanged. `webmcp-disabled-qa.mjs` exercises DOM/engine contracts and can also run unchanged.

Other inherited browser suites combine reusable user workflows with Three.js internals. They cannot establish Cesium correctness by substituting fake `geometry`, `material`, `controls`, vector or renderer objects. In particular:

| Existing browser suite | Reusable workflow | Required native replacement |
| --- | --- | --- |
| `qa.mjs` | Import/edit/filter/save/reopen/keyboard | Orthographic cameras, globe vectors, terrain meshes, GPU-loss assertions |
| `gis-qa.mjs` | Coordinate reference fixtures | Native WGS84/ECEF and window-coordinate checks rather than scaled Three scene vectors |
| `assistant-qa.mjs` | SI/MCP flows, external grants, linked selection | Billboard triangles, pick projection and ground effects |
| `wkt-wmts-qa.mjs` | WKT import/edit/table and multiple server workflows | Primitive picks, imagery/terrain providers, retention/zoom checks |
| `hardening-qa.mjs` | Save/discard/cancel and LOD | Native cameras and actual wheel/fit navigation |
| `display-qa.mjs` | Bounded packets, effect controls and member selection | Native cell/heat/bloom render output and ground placement |
| `desktop-feel-qa.mjs` | Continuous table selection, live sliders, context menus | Native trails, focus and playback fades |
| `navigation-views-qa.mjs` | Compass, layer controls, themes, playback | Native camera directions/tilts and isolated ground emission |
| `workspace-controls-qa.mjs` | Facets, shortcuts, table, slider persistence | Native resource reuse, orbit handles, zoom-to-cursor and mode transitions |
| `globe-transition-qa.mjs` | Repeated globe/map/space-time transitions | Native imagery/provider counts and pixel stability |
| `map-presets-qa.mjs` | Offline catalog/menu and attribution | Native imagery resources/canvas capture |

The retired Three.js runners listed above have been removed; their historical logs remain in `docs/validation`. `map-presets-qa.mjs` and `compact-navigation-qa.mjs` forwarding wrappers are also removed. Use the focused suites directly.

`npm --prefix frontend test` runs all fast unit tests through Node's standard test runner. The local release gate uses that same command. `npm --prefix frontend run test:ui` runs the narrower Cesium integration suite with the real Rust bridge and desktop CSP. It retains GPU resource invalidation, fade/afterimage lifecycle, independent ECEF references, native cluster picking/viewport refinement, portable scenes/groups, import routing/review, editing/history and polar imports. Repeated feature matrices are owned once:

| Coverage | Maintained browser suite |
| --- | --- |
| Navigation, picking and zoom/tilt bounds | `navigation-qa.mjs`, `navigation-sphere-qa.mjs` |
| Exact time windows and live scrubbing | `sidebar-time-qa.mjs` |
| Attribute columns, sorting and range selection | `event-table-qa.mjs` |
| Playback pacing and moving-window transitions | `playback-speed-qa.mjs`, `playback-transitions-qa.mjs` |
| Native terrain accuracy and mode transitions | `cesium-terrain-qa.mjs` |
| WKT shapes, WMTS cache/offline/server workflows | `wkt-wmts-qa.mjs`, `gis-files-qa.mjs` |
| Basemap composition and styling | `basemap-qa.mjs` |
| Pattern analysis and chart actions | `patterns-qa.mjs`, `chart-shortcuts-qa.mjs` |
| Theme contrast and local help | `spectrum-qa.mjs`, `webmcp-disabled-qa.mjs` |

The inventory in `scripts/validation-suites.json` lists every maintained suite, with no retired-file exclusions or forwarding aliases. Rust and numerical unit cases remain separate where they exercise different invariants; reducing script count is not a reason to discard filesystem, document-identity, numerical or async-edit regressions.

The main suite covers Excel and CSV import controls, editable date-order/clock/MGRS mapping, rejected-coordinate review without premature replacement, native ECEF reference positions, four scene modes, cursor-anchored wheel zoom, native picking, exact table/range and cluster-member selection, portable native-camera state, time-only markers, WKT, dense display/effect resources, actual effect pixels with markers/tracks disabled, DTED installation, imagery retention, playback, analysis evidence, charts, saved groups, inspector edits and history. Passing backend tests is not a substitute for passing renderer checks. Resource existence alone does not prove that an effect was visible; pixel checks and rendered screenshots supply that separate evidence.

## Evidence and limits

Runtime results are recorded under [`docs/validation/cesium-prototype-2026-10-15`](validation/cesium-prototype-2026-10-15). Until a passing result exists for a check, entries above are requirements or code-level inventory. Software-rendered Linux tests cannot certify dedicated-GPU throughput, native macOS/Windows WebViews or a physical smartcard. No GitHub-hosted runner is needed for local validation. Existing limits on import budgets, exact queries, bounded rendering and analysis remain in force; replacing the renderer alone does not establish million-marker interactive performance.

The [28-check native integration report](validation/cesium-prototype-2026-10-15/integration-final.json) passed under the desktop CSP with no policy violations, uncaught errors or browser-side public requests. It records actual camera-driven refinement from level 17 to 22, 799 individual visible records from a 12,000-record source without changing exact filter totals, terrain-active 2D wheel zoom, and real ±89° CSV import/fit/native picking. Separate native WebKitGTK, WMTS/WKT, context-recovery, million-row and ground-effect pixel reports carry their own scope and limits in the evidence index; they must not be inferred merely from this main suite passing.
