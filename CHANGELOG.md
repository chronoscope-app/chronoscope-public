# Changelog

Chronoscope is experimental. Source versions and downloadable builds can differ; [installation status](docs/INSTALLATION.md) records current availability and verification limits. No production-ready release is currently advertised.

## Unreleased

## 0.16.4 — experimental preview, 2026-10-29

[Windows x64 and Apple Silicon macOS downloads](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.4) use per-platform source commits: Windows `b5146aa48db73b60bc9ef7353758cd90782d70f3` and macOS `498b888a93bc95d5491dec1915a4c624354cd1c3`. Application code, assets and dependency locks are byte-identical; the later commit repairs Mac validation cleanup. Both exact packages passed narrow native hosted validation. Windows is unsigned; macOS is ad hoc signed and not notarized. Matching source companions, notices, checksums and validation receipts accompany the downloads.

### Added

- Replace the five-rocket demo with 128 Starlink satellites (46,208 predicted positions) and 700 Falcon 9 launches spanning 2010–2026 at three launch pads. Retain source dates, coordinate assumptions and credit; keep the full 43-million-state source as an optional local stress fixture.

- Keep attribute-table controls and retained rows attached during playback, so close clicks, hover, focus and scroll remain stable in docked and detached Event/GIS tables.

- Expose confirmed map graphics reload as MCP `view_reset` and CLI `view reset --confirm`; add `view height time|altitude|ground` shortcuts, height/import discovery details and matching generated contracts.

- Show physical altitude in Globe with a sliding Time Height / Altitude selector and a persistent elevation slider (disabled in Altitude), explicit units/references on import, EGM96 conversion, and saved height mode. Add offline examples with 88,018 samples from 100 distinct flights; the earlier JAXA rocket example is replaced by the SpaceX demos above. [Sources, caveats and reproduction](docs/ALTITUDE-DEMOS.md).
- Replace the renderer badge with a Reset map icon after Preferences. Confirm the graphics reload with Cancel focused by default; retain the dataset and camera.
- Pin native Tauri core to 2.12.5 (build 2.7.4; JavaScript API/CLI 2.12.4). Keep app and bundle metadata aligned so native titles identify the build.

- Keep Event and GIS attribute tables in one detachable tab group, with left-aligned tab titles, table-local search and continuous horizontal column loading. Retain tab state and linked selection when moving or docking the group. Give SI chat clear Detach/Dock controls while preserving drafts and active requests.
- Expand Help → Demo datasets from six to thirteen offline examples. Include the existing website earthquake/crime samples and shorter hurricane workspace, full-year USGS earthquakes, NASA FIRMS South America detections, World Bank electricity access and historical JHU CSSE COVID snapshots. Preview images open their exact saved scenes and year filters.
- Add fixed numeric point/polygon colors with a persistent measurement legend and missing-value color. Country statistics can show the latest observation per entity in a time window; all source rows remain available to charts and tables. Retain source snapshots, checksums and embedded credits.

- Choose how dates and times appear in Preferences → General: system locale, ISO dates, month/day/year or day/month/year, short or full years, dotted or month-name dates, and 12/24-hour clocks with optional seconds. Displayed times remain UTC; stored timestamps, exact inputs, imports and exports retain their original precision.
- View interactive query tables and bar-chart previews inside compatible external MCP chat clients. Search and sort the returned page, and select rows or chart marks to select the corresponding Events in Chronoscope. Clients without MCP Apps support still receive structured results. This viewer is hosted by the external chat client, separately from Chronoscope's SI chat.
- Record the app window as an MP4 through MCP while panning, zooming or playing a timeline. Recording currently requires the native desktop on macOS 15 or later; Windows and Linux video capture are not supported.
- Give connected MCP clients live timeline controls, bounded performance traces, waits for map readiness, saved navigation recipes with cancellation, and subscriptions to workspace, view, result and job changes. These controls require the relevant running desktop/session; they do not require video recording. See [live MCP tools and limits](docs/MCP-LIVE.md).
- Bundle basic offline Balanced world terrain. Unload or restore it, replace it with custom DTED, and preserve its built-in identity in portable workspaces without copying the world pack into each file.
- Run guided data profiles, duplicate-group searches, outlier detection and trajectory summaries locally, with scope and field choices, progress, cancellation and saved linked results. No SI connection is required.
- Review an import's mapping and full-file quality before accepting it. Return to mapping without losing the draft, review location gaps and possible duplicates, and export the complete rejected-row report before importing Events.

### Improved

- Remove the bottom-left display description overlay from map views, including heat-map smoothing, density, clustering and bloom text.

- Make the playback popup compact and give Fade the same switch style as other toggles. With Fade enabled, departing markers, tracks and trails fade more quickly. With Fade disabled, playback retains a growing filtered history until the next loop; the map, table, selection and query scope agree. The setting persists in saved views and workspaces and is available to MCP clients.
- Organize Preferences into General, Workspace, Display and Agent access. Draft edits survive category changes and agent setup; Save applies all categories and Cancel discards form edits.
- Default new profiles to System appearance and follow live system light/dark changes. Retain explicit saved Light/Dark choices. Changing appearance or date/time display preserves the camera and loaded map/terrain resources. Remove the distracting terrain-status banner from the map; terrain details remain available in Layers and Terrain settings.
- Use one time-elevation slider in Globe and Time, with zero turning elevation off. Simplify navigation controls, use a hand icon for dragging, and preserve reversible pane collapse for older expanded workspaces.
- Extend the Time view's ground across the visible viewport while preserving its time-axis reference. Place four draggable grab spheres at the viewport edges and load imagery for the expanded area.
- Add Sync views to share geographic focus and heading across Time, Map and Globe, with shared tilt between Time and Globe. Keep Map flat while allowing rotation, and preserve each view's camera in workspaces and named views.
- Add clickable Time and Map thumbnails for all six offline demos. Improve demo-picker contrast and arrange New analysis with suggestions on the left and task details on the right. Rename the toolbar views to Time and Map, and show the app version in native window titles.
- Add a welcome workspace with Open data, offline demos, recent saved workspaces and keyboard hints. Dialogs keep keyboard focus and return it to the initiating control when dismissed.

### Fixed

- Update Tokio to 1.53.3 to address RUSTSEC-2026-0386 (AsyncFd I/O safety). Retain matching dependency notices and source.

- Share identical in-flight imagery requests and retain loaded imagery during viewport refreshes, avoiding empty replacement canvases. Keep stationary cameras from triggering unnecessary redraws.
- Preserve the full Event selection during slower double-click zoom, including off-screen Events and selections larger than the displayed subset. Prevent delayed restoration from overwriting newer selections, edits or workspace changes.
- Correct terrain-picking failures, polar view synchronization, live playback responsiveness and full-range pause behavior. Stop stale MCP scenario completions from updating a replacement workspace.
- Keep SI sends attached to their intended conversation through reconnects, retain rejected drafts for copying, and prevent late autosaves from overwriting newer text.
- Keep graphics-recovery warnings visible until restoration finishes.

### Maintenance

- Protect normal local builds and validation with one shared workspace lock, one Cargo worker and serial unit tests. On macOS, monitor CPU/RAM pressure and free disk space and prevent idle system sleep during guarded work, including while the display is locked. Add a preview-first cleanup tool for old completed test profiles that retains evidence and native app profiles.
- Share source verification between local checks and manual hosted builds, including generated-contract checks against the built CLI. Verify version labels through actual app dialogs. Fix Windows short/long-path comparisons in packaging tests and verify Fade survives portable-workspace round trips.
- Reuse generated engine definitions for frontend preferences, filters and saved cameras; separate Preferences/dialog ownership, camera persistence, scene colors and resource-change decisions. Choose explicit error categories for argument validation and saved navigation recipes while preserving older error adapters.
- Index maintained dependency workarounds with version checks and removal gates. Add read-only release preflight/version planning so manifests, lockfiles and release notes stay consistent; preserve historical versions and downloads.
- Separate import, analysis, map settings, table gestures, file routing and operation jobs into focused frontend modules while retaining shared save/close coordination.

## 0.15.2 — experimental preview, 2026-10-23

[Windows x64 and Apple Silicon macOS downloads](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.15.2) use `ece70335d254c2b09437975c82434ca969f30739`. Both exact packages passed narrow native hosted validation; Windows is unsigned and macOS is ad hoc signed, not notarized. Source archives, notices, checksums and receipts accompany the downloads. See [installation status](docs/INSTALLATION.md) for limits.

- Refresh data and imagery continuously during 2D panning, with bounded viewport queries instead of waiting for mouse release.
- Add focused AI explanations and reviewed, additive tag suggestions.
- Validate the actual packaged executables, including Tauri's NSIS bundle marker and the sealed Mac app archive.

- Add bounded WGS84 XY Shapefile and vector GeoPackage imports through Open, reference layers, Events, CLI/MCP, and portable saves. Preserve original files, polygon holes, multipart geometry, exact source IDs and GeoPackage table names. See [supported inputs and limits](docs/VECTOR-IMPORTS.md).
- Pin reviewed Rust vector readers with minimal features and retained dependency licenses. Align the declared Rust minimum with the existing locked dependency requirement (1.96).

- Compact charts now float over the map, with readable small-chart axes and expandable chart notes. Widen chart restores editing controls.

- Preserve fractional-second timestamp bounds in the CLI/MCP snapshot output contract, including global earthquake catalogs.

- Replace uncertain/noncommercial media with public-domain Natural Earth shaded relief and generated synthetic GIS fixtures. Refresh the concise README with eight native Mac screenshots and per-capture credits; retire outdated promo compositions and imagery.
- Security: update Rand to 0.8.6, Calamine to 0.37.0, ZIP to 9.0.5 and locked TLS/certificate dependencies to patched releases. Archive names and stored-data offsets now handle the newer ZIP API explicitly, retaining path, symlink and size checks. Older 0.15.1 preview binaries remain unchanged.
- Publication preparation: privacy documentation, guided bug and feature forms, a pull-request checklist, and explicit owner/publication gates.
- Current source includes export-pair/provenance fixes, updated distribution notices and the documented GLib security backport. The 0.15.2 preview downloads include these changes; older previews remain unchanged.

## 0.15.1 — historical development previews (not included)

These historical builds are context only, not downloads in this clean repository. No earlier binaries, release attachments or source history are included. They were separate builds, not one matched cross-platform release:

| Build | Published | Application source | Status |
| --- | --- | --- | --- |
| macOS Apple Silicon | 2026-10-20 | `d9e6128908736e9777d5cf952c76beb2d7182f54` | Ad hoc signed; not notarized; fresh downloaded-app startup unverified. |
| Windows x64 | 2026-10-21 | `59a22e4af509bec70a3e184466fd6d546a65b5cc` | Unsigned; Wine console/engine checks; native installation and GUI unverified. |

Highlights include eight chart starters and persistent Rust-backed analytics, fractional-second Event timestamps, SI improvements, collapsible pane rails and expanded space-time mapping. The newer Windows build also includes SI HTTPS client-certificate integration and compass/time-rail changes. Neither executable contains all subsequent `main` changes.

## 0.14.1 — historical macOS development preview

Apple Silicon development build from `f5b30125944e3d11efe3cc7d558ad4e8ac1f5d18`. Packaging revision 2 repaired the local application identity, but fresh quarantined-download startup still stalled on the test Mac. It is historical and is not the recommended preview. Its original release notes and executable are not included here.

This is a curated release summary, not a reconstructed history of every earlier experiment. Future entries should name user-visible changes, exact source, supported platforms and known limitations without carrying test claims forward from a different binary.
