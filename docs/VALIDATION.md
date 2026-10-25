# Chronoscope validation

Latest Next integration on this Mac: [25 October 2026 report](validation/next-integration-mac-2026-10-25/README.md). Restores the previously unmerged workflow/navigation work alongside Balanced terrain and the idle-camera fix. All 401 Rust tests, 27 frontend cases, 15 selected browser suites and 10 attached native checks pass locally.

Map double-click follow-up: the original renderer/full-selection test mismatch and a related slow-double-click app bug are resolved. The complete navigation suite now passes locally. [Investigation and verification — 24 October 2026](validation/map-double-click-2026-10-24.md).

Current Next workflow changes and local verification: [Next workflows, demo previews and synchronized views — 24 October 2026](validation/next-workflows-2026-10-24.md). The report distinguishes passing source/native/workflow checks from reproduced baseline map-QA failures. These changes have not been promoted to Public.

> Historical validation context: earlier source identifiers, runs and package measurements below are not new tests of this one-commit snapshot. Earlier Git history and hosted run logs are not included. See [current platform status](INSTALLATION.md).

This repository replaces the geographic renderer with CesiumJS WebGL2. Earlier reports below describe the upstream Chronoscope renderer and retain their original evidence; they do not establish Cesium rendering correctness. Current Cesium evidence is tracked in [the parity report](CESIUM-PARITY.md).

## Idle render and Radeon performance — 24 October 2026

The [idle-camera explanation and upstream Cesium handoff](CESIUM-IDLE-RENDER.md) documents the rounding mechanism, application workaround and CPU-only reproduction. The [local validation and performance report](validation/radeon-performance-2026-10-24/README.md) includes the native/Chrome measurements, targeted QA repairs, scale checks and the later Radeon power-management failure. The original software throughput failure is retained alongside its passing hardware rerun.

# Event terminology — 15 October 2026

The app now calls timestamped records **Events**. All 24 consolidated local checks and 201 Rust tests pass, including legacy import/recovery compatibility. See the [rename and compatibility report](validation/event-terminology-2026-10-15/README.md). Historical validation logs, benchmark evidence, screenshots and video captures below retain the wording shown when they were produced.

# Map presets and control refinements — 15 October 2026

The [new control/map-source report](validation/map-presets-controls-2026-10-15/README.md) covers offset rotation handles, compass fading, clickable sort headers, left table close, layer double-click actions, and seven built-in map choices. All 24 consolidated local checks pass, with 198 Rust tests and six restrained public tile samples.

# Workspace controls and continuous tables — 15 October 2026

The [workspace update report](validation/workspace-controls-2026-10-15/README.md) covers sortable/collapsible top-ten lists, continuous filtered tables, live sliders, cursor zoom, the compact compass, rotation handles and merged Mac imagery fixes. It includes local regression evidence and fresh real-data screenshots.

# Comprehensive public-data exercise — 15 October 2026

The [full test findings, fixes, screenshots and limitations](validation/comprehensive-2026-10-15/README.md) cover real USGS, NASA FIRMS, NOAA NDBC and GBIF datasets; NASA, USGS and EOX WMTS; DTED2 terrain; independent coordinate/proximity oracles; and a million-row backend stress case. Six functional issues found during the exercise were corrected with regressions. Million-row save/reopen reached this VM's disk limit and remains unverified; physical GPU and native Mac/Windows checks remain separate.

# NOAA hurricane demonstration: 2016–2025

A follow-up uses 3,568 original NHC HURDAT2 records for 83 storms reaching hurricane status in the Atlantic. IBTrACS basin tags exclude Pacific crossover portions. The real CSV imports successfully, all records are retained, all four saved views reopen with NASA WMTS enabled, heat and bloom render without browser exceptions, and the ten-year space-time axis now explicitly includes years. TypeScript/Vite production build and the real browser capture pass. These targeted checks cover the follow-up axis-label change; the 20-check full release validation below preceded it. [Dataset, screenshots and reproduction details](NOAA-HURRICANE-DEMO.md). [Capture evidence](validation/noaa-hurricanes-2016-2025/capture-report.json).

Only 24 unique public NASA WMTS tiles were fetched for this demonstration, at concurrency 1 with at least 1 second between request starts. Final captures reuse them in offline mode, with zero new public requests. The basemap is shaded imagery; this basin-wide example does not load DTED elevation.

# Version 0.13.3: ground heat and compact bloom

All **20 local release checks passed**, including **187 Rust tests**, strict core/native linting, generated contracts, frontend/unit checks, eight browser suites and native Linux desktop/CLI smoke checks. Evidence is in [the release report](validation/0.13.3/validation.json). Rendering is checked on software WebGL2 and software WebGPU; this does not establish physical GPU performance or native macOS/Windows compatibility.

The display regression checks that heat uses exact DTED vertex positions and void indices, time-height changes leave the heat surface fixed while source events move, bloom uses small ground glyphs without count discs, repeated terrain atlas replacements remain valid during MRT rendering, and globe glyphs include the displayed terrain’s depth bias. The Rust regression checks one ground grid across time slabs, exact filtered counts and elevated source evidence. Both effects remain off by default. The existing injected-render-failure check still verifies ordinary rendering recovery. The [additional WebGPU regression](validation/0.13.3/display-webgpu.json) passed on SwiftShader. A [final triangle regression](validation/0.13.3/logs/browser-assistant-final.log) confirms time-only triangles remain visible with bloom in map/globe views without emitting glow. A final frontend rebuild includes that visibility correction.

[Current screenshot gallery](screenshots/current/README.md) and [Current screenshot gallery](screenshots/current/README.md) show **3,000 synthetic events**, real public DTED `n43.dt0`, and NASA GIBS annual Landsat WELD imagery at tile level 12 near Hamilton, Ontario. Terrain is at 1× vertical scale. All four imagery tiles and the capabilities document came from the existing local cache in offline mode: **zero new public WMTS requests**. These are application captures; image pixels are not independently validated geodetic measurements. The configured NASA imagery is from 2000-12-01, while the event times are synthetic in 2026.

Bloom was redesigned after consulting [Esri’s point-density bloom guidance](https://developers.arcgis.com/javascript/latest/visualization/high-density-data/bloom/). It independently implements compact additive ground points, rather than claiming identical Esri output. Earlier screenshots and training videos show the older glow style and elevated heat slabs.

# Version 0.13.2: desktop interactions, map continuity and playback

All **20 local checks passed**, including **186 Rust tests**, strict core/native linting, generated contracts, frontend/unit checks, eight browser suites, and the Linux desktop build plus CLI/MCP smoke test. The update includes main's `15b3698` attached-CLI `client_connect` fix. No GitHub runners or public WMTS requests were used. [Validation report](validation/0.13.2/validation.json).

The new [desktop interaction regression](validation/0.13.2/logs/browser-desktop-feel.log) verifies plain-click replacement, Ctrl/Cmd toggle, Shift/Ctrl+Shift blocks across pages and sorted fields, map selection synchronization, disabled table text dragging, editable text selection, immediate automatic effect toggles and rejection of invalid advanced settings before RPC. Playback receives continuous animation callbacks, keeps geographic bounds fixed and commits a valid final time window. This is a functional regression, not a physical-GPU FPS benchmark.

The [WMTS regression](validation/0.13.2/logs/browser-wkt-wmts.log) verifies that event updates retain the map mesh/texture and a cached viewport reload never publishes an empty replacement, alongside exact layer visibility, transparency, opacity, zoom handoff, cache/offline reuse, globe and DTED draping. All imagery comes from local synthetic providers. Prior separate runs also exercised the same continuity checks before the release run.

Labels and app rows suppress text selection and default browser context menus. Text fields, help and copyable output keep normal selection. **Native macOS WebKit/Siri interactions and physical GPU frame rates were not exercised in this Linux environment.** The event deduplication path compiles in the desktop build; the browser suites run through the local HTTP host. Detailed display overrides remain available under Advanced, with both Heat map and Bloom off by default. Earlier release evidence below describes historical behavior.

# Version 0.13.1: deactivate the extension bridge

Standard CLI and desktop builds exclude the browser broker and its five host commands. The frontend no longer contains extension setup, pairing, export controls, tooltips or a WebMCP help topic. Ordinary inbound MCP and outbound stdio/Streamable HTTP remain supported. The earlier implementation and its experimental tests are retained behind a non-default developer feature; direct, extension-free WebMCP access is future work.

The local regression verifies that all five former commands fail, no extension archive is created, schemas/capabilities do not advertise an active bridge, and the rendered connection/help dialogs contain no extension setup. The preserved broker also passes its opt-in Rust test. All 19 local release checks passed, including 181 Rust tests, strict linting, seven browser suites, and the Linux desktop build/CLI smoke test. No GitHub runners were used. Current release evidence: [validation report](validation/0.13.1/validation.json) and [retained broker test](validation/0.13.1/experimental-broker.log). Earlier version evidence below describes historical functionality.

# Version 0.13.0 display LOD and browser WebMCP

All **181 Rust tests** and **19 local checks** pass: formatting, strict core/native Clippy, generated contracts, frontend build, three JavaScript unit checks, seven offline browser suites, Linux desktop build and real desktop CLI/MCP smoke. [Results and retained logs](validation/0.13/validation.json) and [tested source hashes](validation/0.13/source-files.json) identify the release. Test debug symbols were disabled to fit the VM disk budget; test behavior and debug runtime optimization were unchanged. Failed intermediate checks exposed real rendering/resource bugs and test fixtures needing explicit Points mode or isolation from default culling; the final complete run is green.

Display regressions cover exact cells/members/selection, high-u64 IDs, dateline/poles, negative UTC slabs, coarsening without dropped counts, nonnegative weights, selected-cache overlays, saved display options, retained null-coordinate triangles, mixed WKT/cell selection, automatic zoom declustering, empty density buffers, light contrast and bloom failure recovery. Software WebGPU **and** WebGL2 display paths were exercised, including preferred-backend globe imagery and WebGPU device loss → WebGL2. [Preferred-backend display report](validation/0.13/display-webgpu.json), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md) and [Current screenshot gallery](screenshots/current/README.md) are retained. Public capture testing used a copied local cache and a maximum six-tile footprint; that cap is only a test safeguard, not an application restriction.

CPU/transfer probes used [100,000](validation/0.13/display-benchmark-100k.json) and [1,000,000](validation/0.13/display-benchmark-1m.json) synthetic events concentrated in one region over one UTC day. The million-row debug run retained exact counts in 48 cells: cold grid 5.617 s, cached grid 0.0034 s, selecting all rows 7.976 s, cached grid plus exact selected-count overlay 4.062 s. The first full selected viewport snapshot took 33.310 s and returned 297,772 bytes with at most 2,000 raw evidence markers. Import took 303 s. These are single runs with uncontrolled OS cache, not comparative speedups, tail-latency estimates, global-distribution benchmarks or FPS claims. Cold database work remains material; persistent spatial pyramids and GPU scientific KDE are future work.

Browser WebMCP uses the shipped MV3 background/adapter scripts, a real Chromium page, the official Rust MCP SDK, and explicit local Chrome/draft-API fixtures. It verifies discovery, read/action grants, per-message permission, input validation, cancellation reaching the browser signal, pairing rejection, navigation revocation, fresh grants after reconnect and embedded extension export. This VM's managed browser blocks unpacked extension installation and lacks the current native document.modelContext draft. **Native browser/extension interoperability is not certified.** See [setup and limits](MCP-CLIENT.md) and [Current screenshot gallery](screenshots/current/README.md).

The former training-video validation applied to older builds. Those compositions and embedded media were retired during the commercial-media cleanup; use the [current native screenshot gallery](screenshots/current/README.md). No GitHub runners or paid model services were used. Mac/Windows runtime, physical GPU throughput, hardware smartcard/PIN, signing and notarization remain unverified.

# Version 0.12.0 multi-source maps and outbound MCP

All **176 Rust tests** and **16 local checks** pass on the final implementation: formatting, strict core/native Clippy, generated contracts, frontend build, JavaScript intent/packet checks, all five offline browser suites, native Linux build and desktop CLI/MCP smoke. [Machine-readable results](validation/0.12/validation.json), [retained logs and limitations](validation/0.12/README.md) and [118 source/build/test hashes](validation/0.12/source-files.json) identify this release.

Map checks cover two simultaneous WMTS configurations, bottom-to-top alpha/opacity blending into one GPU surface, inclusive/exclusive zoom switching, portable save/reopen and view-centre zoom at the dateline. The test loads all 64 planned fixture tiles, verifies cache/offline reuse, and drapes the composite on real bundled public DTED. Both GUI disabling and agent-style terrain reconciliation clear imagery while retaining terrain. [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md) and [map evidence](validation/0.12/wkt-wmts.json) are retained. The coloured raster is a local fixture, not real street imagery.

Client checks use an actual managed Chronoscope stdio child and local HTTP MCP services. They verify discovery/grants, schema fingerprints, input validation, revocation, action gating, disconnection/shutdown, session-only state and private management commands that cannot be called by inbound MCP/SI or jobs. HTTP checks cover current 2026-07-28 discovery, 2025-11-25 initialize/session fallback, JSON/SSE results, bearer failure, a 2 MiB response bound and declared output-schema rejection. SI rejects 128 external functions plus its domain functions before contacting the provider. [Current screenshot gallery](screenshots/current/README.md), [SI client evidence](validation/0.12/si-client.json) and [Current screenshot gallery](screenshots/current/README.md) are retained.

No GitHub runners, paid models or public WMTS requests were used. Software WebGPU/WebGL2 and fallback were exercised; physical GPU performance, Mac/Windows runtime, hardware smartcard, signing and notarization remain unverified. Outbound connections/grants are session-only; remote OAuth, resource/prompt browsing, dynamic tool catalogue refresh and a browser WebMCP bridge remain future work. See [map layers](MAP-LAYERS.md) and [MCP client setup and boundaries](MCP-CLIENT.md).

# Version 0.11.0 SI chat and linked selection

All **171 Rust tests** and **16 local checks** pass: formatting, strict core/native Clippy, generated contracts, frontend build, JavaScript intent/packet checks, all five offline browser suites, native Linux build and actual desktop CLI/MCP smoke. [Results and retained logs](validation/0.11/validation.json), [source hashes](validation/0.11/source-files.json), [SI evidence](validation/0.11/si-chat.json) and [selection/viewport evidence](validation/0.11/hardening.json) identify this implementation. A screenshot-timing-only adjustment to the SI browser script was followed by a successful rerun; its final log is also retained.

Rust regressions verify SI follow-up history, clearing/reconnecting/disconnecting, byte/message bounds and UTF-8 truncation, memory-only credentials/history, separate file grants, canonical command discovery with legacy compatibility, exact high-u64 table page reveal, descending sorts, source/filter exclusions and rank invalidation after an edit. Existing permission, cancellation, scope and tool-budget tests remain passing.

The browser connects to a local scripted service, verifies setup closes into a docked chat without covering the scene, sends a real tool request, tests a contextual follow-up, closes/reopens and clears chat, and clicks an actual marker to reveal its second-page table row before selecting another row back in the scene. The 26k-record test selects all records, zooms to a viewport containing **55 markers beyond the 20k-ID selection summary**, and verifies all **55 are highlighted**. Screenshots show [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md) and [Current screenshot gallery](screenshots/current/README.md).

All map/terrain/WMTS browser checks use local fixtures with **zero public WMTS requests**. No paid model, physical GPU, Mac/Windows runtime, smartcard, signing or notarization verification is claimed. No GitHub runners were used. This release retains bounded representative rendering; [zoom clustering/density and other display strategies](DISPLAY-SCALING.md) are documented recommendations, not shipped clustering or measured FPS improvements. Archived performance bundles keep their original terminology and hashes.

# Version 0.10.0 agent setup and workspace controls

All **167 Rust tests** and **16 local checks** pass: strict core/native Tauri Clippy, formatting, generated contracts, frontend build, two focused JavaScript suites, all five offline browser suites, native Linux build and a new headless CLI/MCP smoke test using the actual desktop executable. [Machine-readable results, source hashes and retained logs](validation/0.10/validation.json) identify the checked implementation. A final documentation-only sentence change was followed by successful frontend/native rebuilds.

New agent regressions use a real authenticated live bridge: CLI enable without a root choice, default private exchange scope, status/config discovery, a live selection change, generated client configuration launching actual stdio MCP, scoped file rejection, custom-root changes, disable/restart, malformed settings, descriptor ownership and quoted executable paths. The desktop executable runs `--help`, `agent enable/config/disable` and actual MCP initialization/tool discovery/query **without DISPLAY or WAYLAND_DISPLAY**. This proves the CLI entry point runs before webview creation on this Linux build; native Mac/Windows runtime remains unverified.

Browser checks verify the single toolbar row, explicit table close and retained setup, and at least **4.5:1 computed contrast** for the tested light-mode axis labels, legends and overlays. Light/dark [Current screenshot gallery](screenshots/current/README.md) are refreshed. GIS, all-view wheel zoom, selection, analysis and software WebGPU/WebGL2/device-loss checks still pass. The WMTS menu test creates two named local connections, chooses a second advertised imagery layer, reloads, and switches back while preserving per-server choices. The fixture requests 64 tiles per layer; two raster variants total 128 unique tile URLs, at peak concurrency eight, with cache/offline reuse and **zero public requests**. [WMTS evidence](validation/0.10/wkt-wmts.json) records this. The library persists locally and is not overwritten by opening a portable project.

No GitHub runners were used. No physical GPU performance, native Mac/Windows UI, smartcard, signing or notarization result is claimed. The [Mac handoff](../MAC_HANDOFF.txt) explains rebuilding and using the bundled executable with Codex; an already-installed older app needs rebuilding/updating.

# Version 0.9 performance follow-through

The [ticket-by-ticket implementation review](performance/IMPLEMENTATION_REVIEW_2026-10-14.md) distinguishes adopted fixes from unproven larger rewrites. Current release CPU experiments retain raw runs and binary/fixture identities: [100k prepared statements](performance/current-0.9/prepared-100k.json), [100k indexed queries](performance/current-0.9/indexed-100k.json), [million-row storage](performance/current-0.9/storage-million.json). Million-row medians: ingest 101.668 → 85.299 s (16.1%), sorted category 502.631 → 405.495 ms (19.3%), sorted numeric 539.006 → 334.311 ms (38.0%). Endpoint timing is separate from whole-query timing. Peak child RSS increased 52.4 → 61.7 MiB. Three runs establish neither tail latency nor a general speed guarantee; shared-VM OS page cache was uncontrolled.

All **161 Rust tests**, strict core/native Linux Tauri Clippy, formatting, generated contracts, production frontend build and five offline browser suites pass. The filter-intent suite exercises 30 deterministic bursts, joined drains, CAS rebasing, retry and debounce flushing. Packet tests exercise 0/100/20k/100k and corrupt inputs. Browser checks include saved-camera startup, all-view wheel/button zoom, coherent filter updates, 512 source fields, explicit render budget, exact picking, selection-buffer/terrain reuse, disposal, GIS oracles and device-loss fallback. The local WMTS fixture loads all 64 tiles at peak concurrency eight and reuses them offline. A native Linux debug executable builds successfully. [Final machine-readable checks and logs](performance/current-0.9/validation.json) and [hardening browser evidence](performance/current-0.9/hardening-browser.json) retain the results.

The million-row mode excludes copy/save/reopen/render to fit disk. The separate full 100k runs cover those CPU paths. Physical GPU frame times, native Mac/Windows runtime, smartcards and signed packages remain outside this Linux verification. No GitHub runners or public WMTS requests were used.

# Version 0.8.0 hardening and navigation

All **141 Rust tests** pass, including failed-read state preservation, derived database tampering, nested filesystem scopes, killed-process recovery, post-checkpoint deletion reconciliation, active leases, dense single-entity proximity, independent statistics caches, detached/cancelled HTTP waits, exact saved-context IDs, nested command validation, dry-run output contracts and resolution of every advertised MCP output schema. The wide-terrain regression samples five DTED cells with only five decodes despite the four-tile cache.

Strict core and Linux Tauri Clippy, formatting, TypeScript production build, generated Rust/frontend contract drift checks and a Linux native debug executable build pass. All five local browser suites pass: general workflows/rendered pixels; independent GIS oracles; assistant/aggregation/triangles; WKT/WMTS; recovery guards/navigation/viewport detail. The final geometry regression pans between two 525-feature regions in a 1,050-feature dataset and refines both after the first regional result is below the display limit.

Wheel zoom and on-screen +/− work in **Space-time, Map, Globe and Calendar**. Close Globe zoom adjusts the near plane and geographic viewport, keeping a loaded event near screen center and inside both clipping planes from 500 m above its ellipsoid position; [Current screenshot gallery](screenshots/current/README.md) is from that check. A 26,000-row point test zooms to a small region and reveals events omitted from the 20k overview. The local WMTS fixture serves **all 64 requested tiles**, at peak concurrency eight, composited into **one raster mesh**. Repeat/offline reuse adds no tile requests. Public WMTS requests: **zero**. GitHub runners: **none**. The [machine-readable evidence](hardening-validation.json) records the checks and their limits.

The new [100,000-row debug workload](benchmarks/scale-100k-0.8-debug.json) imports a 15.1 MB CSV, saves a 237 MB indexed workspace and verifies reopen, exact paging, selection, dry-run deletion and export. Import took 39.6 seconds, first filtered sort 126 ms, cached paging 1.4 ms, render packet preparation 702 ms, save 2.8 seconds and reopen 16.5 seconds with strengthened derived-index verification. These are unoptimized shared-VM timings during browser QA; peak RSS was not measured in this run. They do not replace the historical optimized million-row baseline below or demonstrate the 50-million-row ceiling. The stronger open checks intentionally perform dataset-sized verification.

Software WebGPU/WebGL2 and forced runtime fallback rendered successfully. The general suite's 100k instance construction/presentation timings are software-renderer measurements, not interactive FPS or physical-GPU guarantees. A localhost scripted Chat Completions fixture tests the tool protocol, not a paid model's reasoning quality. Mac/Windows runtime, physical GPU, smartcards/PIN behavior, signing and notarization remain unverified here. The current source and [Mac handoff](../MAC_HANDOFF.txt) support local verification; no new Mac binary is claimed. Historical platform/Actions notes below describe earlier releases only.

# Version 0.7.0 direct map caching and WKT geometry

All **122 Rust tests** pass. Eight new tests cover OGC type/dimension/EMPTY forms and collections, WGS84 X/Y order, explicit CRS rejection, invalid topology/ranges/trailing text/nesting, exact shape/bounds intersection including polygon holes, header/value detection, WKT edit/undo/export, ZIP v4 and SQLite v2 reopen with v1 migration, full-resolution tile pagination, direct concurrent requests, cache/offline reuse, partial local settings/persistence/corruption, miss deduplication and HTTP 429 cooldowns. The existing pacing test now explicitly configures its one-second interval; it is no longer a normal-app default.

Strict core and Linux native Tauri Clippy, formatting and production TypeScript build pass. Full browser workflow/pixel QA passes under software WebGPU and WebGL2 with forced device-loss recovery. Independent browser GIS checks pass. The new WKT/WMTS browser suite imports the seven-type CSV through the real dialog, renders holes/multipart shapes, selects actual geometry, verifies that a hole is not filled/picked as its polygon, saves/reopens geometry and loads **all 64 requested local WMTS tiles** with peak concurrency **8**. Repeat and offline loads make no new requests. The [machine-readable report](wkt-wmts-validation.json) records these checks. The assistant/aggregation/triangle UI regression suite also passes.

[Current screenshot gallery](screenshots/current/README.md) and [Current screenshot gallery](screenshots/current/README.md) show **synthetic** WGS84 geometry at different timestamps over the existing real public DTED2 terrain and cached historical NASA Landsat imagery. The scene labels 4× vertical exaggeration, MSL terrain and the 2000-12-01 imagery date. New captures made **zero new public WMTS requests**; the [capture report](wkt-terrain-validation.json) records cache counters, camera, terrain and shape data. Our restrained public-server testing is separate from normal app loading settings.

Browser stress timings in this run were about 265 ms for 100k space-time instances and 3.37 seconds for 100k Globe instances under software graphics. These are construction/presentation timings, not physical-GPU frame rates or native-platform guarantees. Native Mac/Windows GUI and smartcard hardware remain unverified. The 0.6 push run (historical development evidence; not included in this snapshot) was again refused before jobs started because of GitHub account billing/spending restrictions; no updated Mac package is available from that run. Live paid SI providers still require a user-supplied key for testing.

# Version 0.6.0 assistant, summaries and time-only markers

All **114 Rust tests** pass: ten new integration tests exercise the actual HTTP tool loop, credentials excluded from status/project/config, permitted and forbidden edits, undo, cancellation/concurrency, file scopes and nested MCP job schemas; aggregation handles dateline/poles, fixed-window boundaries, ordering, anchoring, partitions, numeric means, import compaction, revision guards, preview/replacement undo/redo and portable reopen. Marker checks verify null source coordinates, exact bracketing anchors, dateline interpolation, filtering, ambiguous antipodes and total marker budgets.

Strict core and Linux native Tauri Clippy, formatting and TypeScript production build pass. Full browser workflows/pixels, software WebGPU to WebGL fallback and new assistant UI integration pass. Actual browser clicks select triangle markers whose coordinate fields remain empty. A localhost scripted Chat Completions fixture drives real selection/view tools through the assistant panel; actual stdio MCP and CLI NDJSON sessions also configure/run the assistant. All 62 MCP tools are discoverable. These are protocol/tool tests, **not a live paid-model evaluation** or evidence of a model's analytical reliability.

The opt-in [million-row aggregation benchmark](aggregation-benchmark.json) read a 45,780,043-byte CSV into **1,000 retained summaries** (999,000 fewer records), saved a 24,982-byte workspace and reopened it. Elapsed time was 92.553 seconds including reopen with the unoptimized Linux debug CLI. This synthetic repeated-position workload demonstrates compaction and a functioning large-input path, not a general speed or compression guarantee. The [benchmark script](../scripts/benchmark_aggregation.py) reproduces it. Import still reads/parses every source row.

The browser stress check retained 100k markers: about 408 ms space-time construction/presentation and 4.23 seconds Globe under software graphics. These are construction timings, not physical GPU frame rates. The [Current screenshot gallery](screenshots/current/README.md) combines synthetic time-only reports with the existing public DTED2 terrain and cached NASA Landsat imagery, labelled 4× vertical exaggeration. This capture made **zero new public WMTS requests**. [Current screenshot gallery](screenshots/current/README.md) uses a visibly named localhost test fixture. No native Mac/Windows GUI or physical GPU verification was possible here; GitHub packaging was previously blocked by account billing/spending restrictions.

# Version 0.5.2 native WMTS authentication

All 104 core tests pass, including new authentication origin/identity validation, secret and arbitrary-provider rejection, atomic local storage, corrupt-settings failure, cache isolation and portable-project exclusion. Strict core/native Tauri Clippy, formatting, TypeScript/Vite build and full browser workflow QA pass locally. The browser suite checks anonymous/automatic override controls without public requests. Subprocess tests enforce hard response and wall-clock budgets.

The Apple Silicon macOS job compiled the Swift helper and Rust CLI and passed all 104 core tests. Its localhost server required a client certificate, and the app completed the actual mutual-TLS handshake with the generated OS-store identity **without a per-server override**. The job log (historical development evidence; not included in this snapshot) records that handshake PASS followed by a test-only trust-store cleanup timeout. Cleanup deadlines were subsequently increased. Windows compiled and passed core tests, but its TLS smoke test was blocked during test-root installation; the fixture now suppresses OS confirmation dialogs with certutil's force option. These latest harness fixes remain unverified because GitHub refused to start the rerun (historical development evidence; not included in this snapshot), citing failed account payments or an Actions spending limit. There is no new packaged 0.5.2 Mac download from this blocked run.

This does not verify PIV/CAC hardware, PIN dialogs, cancellation or organizational card middleware. Linux automatic token selection is not implemented. See [WMTS authentication](WMTS-AUTH.md) for exact platform behavior and remaining limits.

# Version 0.5.1 GIS accuracy audit

The [GIS audit](GIS-ACCURACY.md) records corrected equatorial MGRS conversion, Web Mercator terrain scaling/triangle placement, polar omission, DTED datum/void handling, authoritative WMTS CRS handling and WGS84 ellipsoidal distances. The independent fixture covers 833 coordinate vectors, 36 variable-precision MGRS cells, 205 GDAL terrain samples and 106 ellipsoidal distances. Browser math and actual terrain geometry are checked against independent oracles.

The [Current screenshot gallery](screenshots/current/README.md) shows public one-arc-second terrain converted to DTED2 with NASA historical Landsat imagery. Four unique WMTS tiles were downloaded through the app throttle; repeat captures used only the cache. The scene explicitly labels 4× vertical exaggeration. These are numerical/software checks, not a claim of survey accuracy or general datum/geoid transformation support.

All **96 Rust tests** pass, including eight new independent GIS tests. Formatting, strict core/native Tauri Clippy, TypeScript production build, offline GIS browser checks and the full WebGL2/software-WebGPU workflow/pixel runner pass. Forced WebGPU loss still recovers to WebGL2. The extended browser stress path retained 100k markers (about 272 ms space-time construction/presentation and 2.35 s Globe under software graphics); these are not physical-GPU FPS measurements. All four CI platforms passed core tests and native Clippy in the corrected publication run (historical development evidence; not included in this snapshot). Apple Silicon packaging passed; its 0.5.1 DMG/CLI artifact digest and Info.plist were verified. Other platform packaging continues in that run. A packaged Linux AppImage reopened the embedded-DTED study as UID 1000, restored the camera and returned actual 1×/4× terrain captures through attached MCP, using only cached imagery. Interactive Mac/Windows and physical-GPU testing remain outstanding.

---

# Version 0.5 validation update

87 Rust tests pass (13 unit, 29 agent/scale, 15 geospatial, 18 import/workspace, 3 view/layer and 9 workflow). Formatting, strict core and native Tauri Clippy, and TypeScript production build pass. Tests cover nested schema rejection, atomic rollback, revision/retry controls, cursor invalidation and exact high IDs, cancellation, bounded jobs/results, import tickets, authentication/root scope, portable SQLite/DTED and removal of saved undo/deleted payloads. These checks improve robustness; they are not a certification or unlimited-scale guarantee.

The standard Python MCP SDK also initialized the release CLI, discovered all 51 tools, validated structured snapshot/query/aggregate/schema/capability/diagnostic results and an error result against output schemas, and read all three resources and the investigation prompt.

A real stdio MCP client attached to the packaged Linux desktop, discovered 51 tools, queried and filtered data, changed the shared selection, edited an event, completed/released an asynchronous analysis job, changed Map/Globe display and captured actual canvas PNGs. Agent access was disabled and its descriptor disappeared. A final-package follow-up loaded/unloaded DTED and changed the theme via attached tools, then captured the resulting map and light globe. The app ran as UID 1000 under Xvfb with software graphics. Captures: [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md). No public WMTS requests were made by these checks.

The final browser runner exercises imports, tables, selection/edit/undo, save/open, terrain, themes, map/globe modes and rendered pixels using software WebGPU and WebGL2. Forced WebGPU device loss recovers to WebGL2. This Linux environment exposes no physical GPU. Native Mac/Windows UI execution and physical Metal/D3D/Vulkan performance remain unverified even if platform CI builds succeed.

## Million-row storage benchmark

`CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 cargo run --release --example scale -- 1000000` reproduces the no-network test. It generates a 151,677,947-byte CSV with seven columns, 100 tracks and long labels; verifies one million accepted events, exact filtered counts, indexed cursor paging, a 20,000-point render packet, aggregates, portable save/close/reopen, exact selection, dry-run rollback and full CSV export. Final measurements are recorded in [the benchmark JSON](benchmarks/scale-1m-0.5.json).

Measured peak process RSS was **121.6 MiB** (124,536 KiB), excluding OS filesystem cache and other processes. Import took **136.0 s**; the first filtered/sorted 100-row projection took **791 ms**, and its next cached page **0.61 ms**. The 20k render-data packet took **1.05 s** (backend preparation, not GPU presentation), exact aggregation **1.78 s**, save **16.14 s**, reopen **17.94 s**, and full export **4.53 s**. Native packaging and software-GPU browser QA ran concurrently during import on this shared Linux VM. These timings are events for this workload, not throughput guarantees.

The separate browser stress check constructed/presented 100,000 synthetic markers in roughly **324 ms** for space-time and **3.46 s** for Globe, including two animation frames under software graphics. It checks a renderer stress path, not the default 20k packet or interactive FPS.

The CSV path holds bounded batches rather than all rows. Large workspaces are portable SQLite files. Disk-backed attributes/FTS/indexes make this particular saved file about 2.39 GB; working copies, backups, journals and compaction require several times the stored size in free disk space. First sorts and summaries still perform dataset-sized work; cached paging/summary reads are much faster. The 50-million-row ceiling was **not** tested.

Rendering remains a disclosed representative packet; up to one quarter of the packet (at most 5000 points) is reserved for selected evidence. Queries/aggregates/selection remain exact across all stored events. Box/click selects rendered representatives. Pattern analysis defaults to 200k rows and reports truncation. Excel is still memory-backed with explicit size/cell/row budgets. Adaptive viewport LOD, global terrain streaming, autosave/recovery and durable job/idempotency state remain future work.

## Silent product intro

The 42-second 1920×1080 H.264 MP4 was remuxed without transcoding its pictures. `ffprobe` reports exactly one video stream and no audio stream. The editable Hyperframes composition also has no audio element, and its lint/runtime/layout checks pass. The original product pictures are preserved.

## Platform distribution

The 0.5 Linux AppImage and standalone CLI are built locally. All four CI platforms passed the core formatting, strict Clippy and Rust tests. The native Apple Silicon macOS CI job passed all checks and produced the app/DMG and CLI. The artifact ZIP passed its published SHA-256 digest and ZIP integrity check; its Info.plist reports 0.5.0 and its CLI is Mach-O arm64. This is build/package verification, not a claim of interactive Mac testing. GitHub Actions runs the same core checks and native desktop packaging on Linux, Windows, Apple Silicon macOS and Intel macOS. The 0.5 platform build run (historical development evidence; not included in this snapshot) records native build and packaging results. Distributions are unsigned development packages; signing/notarisation and native Mac/Windows UI testing remain outstanding.

---

# Version 0.4 validation update

58 Rust tests pass, including new source visibility, numeric/mixed-text attribute sorting, exact IDs, table pagination, manifest-3 view/table/zoom persistence and version-2 migration. Strict core and native Tauri Clippy, formatting, TypeScript production build and a real stdio MCP session with 33 tools pass. The session called the new attribute-table tool and checked returned rows and string IDs.

The extended browser runner checks orthographic north-up Map with no time axis, labels, stems or focus plane; flat terrain and saved zoom; WGS84 ellipsoid equatorial/polar vectors; short dateline arcs; globe camera fit for a small study; hidden-hemisphere picking and box selection; source context menus, original attribute columns, hidden/unlocated rows and optional filter scope; light/dark globe; synthetic regional imagery on the common globe surface, continuous interior coverage and below-sea-level DTED draping. These are actual pixels and interactions, not backend initialization labels. The common-globe atlas shader passed green-pixel checks on both WebGL2 and software WebGPU. Forced device loss while in Globe recovered to WebGL2.

The bounded 100,000-marker check measured roughly **0.36 s** for space-time construction/presentation and **2.40 s** for globe construction/presentation in the final run (two animation frames included). Every marker was retained and the globe trail budget was not reached. An earlier globe run including initial image/shader work took 3.60 s. These software-GPU, concurrent-build measurements are not interactive FPS, peak memory, physical-GPU throughput or million-event validation. Globe startup/buffer construction and attribute-heavy query costs need further profiling.

The offline NASA Blue Marble was fetched once and bundled. WMTS repeat checks reused warm NASA capabilities/tiles with **0 new requests**; synthetic raster tests make no remote calls. Globe terrain is a regional DTED mesh, and the renderer does not stream global terrain or fetch camera-dependent tiles. MSL heights are display offsets without a geoid conversion.

The finalized 0.4 Linux AppImage ran as UID 1000 under Xvfb using its bundled WebKit runtime and WebGL2 fallback. Alt+2 opened Map, Alt+4 opened Globe, and F fitted the study. Ctrl+O/native picker opened the portable Ontario sample, restoring 144 events and embedded DTED; cached NASA imagery rendered on the curved terrain. Right-clicking its data layer opened the 50-row attribute table, and F1 opened the offline version-0.4 guide. Native console output was empty. Captures: [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md).

Captures: [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md). The source handoff includes the current Mac build steps. Native macOS/Windows and physical-GPU performance remain unverified.

# Version 0.3 validation update

55 Rust tests pass and cover the existing engine plus date order inference/ambiguity, separate clocks, epoch units, Excel serial systems/native date cells, minute flooring (including negative epochs and submillisecond Excel rollover), malformed timestamps, MGRS centres at every supported precision, automatic CSV delimiters/coordinates, explicit UTM defaults, archive path/resource/version validation, edited-data/filter/view/group/terrain persistence, legacy migration and reusable extraction caches. Strict core Clippy and the TypeScript production build pass.

The browser workflow now exercises hover tooltips, searchable F1 Help and keyboard reference, manual date-order sample preview, semicolon CSV with split clocks and spaced/short MGRS, text-edit shortcut isolation, view shortcuts, Save/Save As/Open, restored actual camera/layout, embedded DTED, selected data delete/undo and offline exploration after a failed map request (one attempt, no filter-triggered retries). The opt-in NASA check reused warm capabilities/tiles and reported **0 new network requests**. Software WebGPU rendered pixels and recovered to WebGL2 on forced loss. Native Mac and Windows remain unverified; use the Mac handoff to build locally.

The finalized 0.3 Linux AppImage ran as UID 1000 under Xvfb without admin privileges. Native F1 opened the guide, Ctrl+A selected all 192 demo events, Ctrl+O opened the native picker, and selecting `ontario-study.chronoscope` restored 144 events, its camera, embedded terrain and cached NASA drape. [Current screenshot gallery](screenshots/current/README.md) and [Current screenshot gallery](screenshots/current/README.md) capture this package. Native menu routing was also exercised. macOS and Windows execution remain outside this environment.

Captures: [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md). The bundled synthetic flexible-import CSV/XLSX exercise these new formats without a map server.

# Validation, version 0.2

Checked on 2026-10-13 in an ordinary-user Linux x86_64 Debian 13 workspace, Rust 1.99, Node, Chromium 154 and WebKitGTK 2.52.6. Captures are actual application windows or browser-rendered interfaces; no mockups are used.

## Rust and protocol checks

- `cargo fmt --check`: passed.
- `cargo clippy --locked -p chronoscope --all-targets -- -D warnings`: passed.
- `cargo clippy --locked -p chronoscope-desktop -- -D warnings`: passed using the local WebKitGTK/GTK SDK.
- `cargo test --locked -p chronoscope`: **37 passed**: 13 unit, 15 geospatial/protocol and nine workflow tests.
- Standalone CLI and Tauri release executables built successfully; frontend TypeScript/production build passed.
- A real stdio subprocess initialized MCP, accepted a notification without a response, changed selection and returned the changed workspace as protocol-only JSON-RPC output.
- Root-scope rejection and terrain-autoload scoping verified. WMTS throttle and cache tested against a local HTTP fixture, with two requests at least 950 ms apart and a repeat cache hit.

Core checks cover timestamp/Excel dates, custom formats, rejected rows, source preservation, project/filter validity, atomic writes, CSV formula guarding, exact coordinate persistence, indexed analysis against brute force near the dateline/poles, transitive clusters, checksum/truncation errors, metadata-based WMTS addressing and layer limits, geographic axis order, selection including unlocated events, editing/undo and protocol behavior. The XLSX fixture includes two sheets, native date cells and header/blank-row offsets. XLS/XLSB are library-supported but lack independent fixtures here.

## Independent public-data checks

The included [terrain regression fixture provenance](../tests/fixtures/terrain/SOURCES.md) record download origins and provenance.

- GDAL's public `n43.dt0`: Rust reports 121×121 posts, bounds −80/43/−79/44 and a centre sample of **75 m MSL**, matching independent GDAL/rasterio decoding. Independent raw valid extrema are 75–460 m; a resampled mesh has 75–449 m, since resampling need not retain the highest original post. The 129² viewport is fully covered: **16,641 vertices**. Corrupt checksums and truncation are rejected.
- WGS84 DD/UTM/MGRS vectors independently agreed with the GeoTrans-backed Python MGRS package, including Manhattan, southern-hemisphere Sydney, Norway/Svalbard special zones and both polar UPS regions. UTM and MGRS import retain original strings and canonical DD.
- A public USGS weekly earthquake CSV snapshot imported **390 valid events**, including its place labels and magnitude values. The snapshot is included rather than repeatedly polling a feed.
- NASA GIBS `BlueMarble_ShadedRelief` and `GoogleMapsCompatible_Level8`: the Ontario viewport uses two cells (matrix 8, column 71, rows 93/94). One San Francisco tile was also checked. Overall public traffic was **one capabilities document and three unique tiles**. Final repeat end-to-end tests reported **zero new requests**, reusing the disk cache. Requests were sequential, at most one/second, without broad prefetching.

Terrain test events are [explicitly synthetic](../tests/fixtures/terrain/terrain-study.csv); the DTED elevation and WMTS imagery are public data. Imagery is visibly draped directly on the actual terrain mesh. A separate geographic-raster test checks that an EPSG:4326 latitude-45 stripe aligns at the independent EPSG:3857 Y reference after reprojection.

## Browser and native UI checks

The retired `frontend/scripts/qa.mjs` runner started its own authenticated loopback Rust bridge, checked unauthorized access rejection and exercised the upstream renderer as recorded below. Current suite ownership is documented in [the parity report](CESIUM-PARITY.md). Its historical checks included:

- Large 1062×753 scene at 1600×1050, expanded workspace, light/dark themes.
- Text filtering with source-attribute matches, pattern execution/evidence selection, table selection, edit and undo.
- Actual CSV/public-CSV/Excel/MGRS import menus, including the Excel unlocated event and selecting all five records despite four 3D markers.
- Actual DTED file and folder menus, fully covered terrain sampling, exaggeration and native-engine elevation query.
- WMTS server menu, capabilities/layer choice and imagery draping in the opt-in public check.
- WebGL2 and actual WebGPU rendered pixels, not merely initialized backend labels. Software WebGPU needed Chromium's Vulkan/SwiftShader switches in this environment.
- Deliberate WebGPU device destruction followed by automatic WebGL2 recovery with data/scene preserved.
- A bounded 100,000-event synthetic geometry workload. Scene construction/presentation measured roughly **0.36–0.71 seconds** in this software-rendering environment across checks. This is not an interactive FPS, hardware throughput or million-event claim; WebGPU's per-frame counters reset asynchronously, so no draw-call claim is derived from those sampled counters.

Captures: [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md), [Current screenshot gallery](screenshots/current/README.md). Native Tauri ran at 1600×1000 under Xvfb with WebGL2 fallback. The packaged native file picker and [Current screenshot gallery](screenshots/current/README.md) also opened successfully; native dropdown/checkbox contrast was verified after explicit color-scheme styling. A release executable used embedded assets after the Vite server was stopped; native search changed the Rust-engine view from 192 to 53 events.

The build environment lacks installed WebKit runtime helpers; they were extracted into a user directory for SDK/native development tests. The finalized **105 MiB Linux AppImage** additionally includes those helpers and GLES and ran directly with `--appimage-extract-and-run`, without the test-only filesystem relocation tool or admin privileges. A [Current screenshot gallery](screenshots/current/README.md) records the result. The bundled ELF dependency check found a glibc **2.39** minimum for this Linux artifact. The Linux finalizer records that portable packaging work in a reproducible script. Production Tauri does not expose the browser QA HTTP bridge.

## Performance and limits

`cargo run --locked --release --example benchmark -- 100000` measured a sparse 100k-event core case: indexed proximity **180 ms**, no findings/truncation, and text filter **7.4 ms** with 55,000 matches. Dense neighbors, large attributes, full snapshots and CPU picking have different costs. See architecture and README for bounded caches, request scheduling, instance/batch rendering and the supported 250k-event ceiling.

## Platform validation boundary

Native Linux execution and release builds were checked here. Native macOS/Windows execution, file pickers, signed distribution and remote build jobs were not available in this Linux workspace. The new TLS dependency also needs a cross-target C compiler: a Windows GNU cross-check stopped because MinGW GCC was absent. Version 0.2 therefore makes no successful Windows/macOS cross-check claim based on the earlier egui prototype's results. A native CI matrix is supplied for Windows, Linux and both Mac architectures; it has not been executed remotely here.

Long-running multi-million-event/out-of-core interaction, exhaustive malformed-input fuzzing, arbitrary WMTS implementations and sparse/nonstandard DTED are outside this validation. The UI/algorithm feature-parity boundary, including legacy-only workflows, is explicit in README.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
