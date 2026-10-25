# Changelog

Chronoscope is experimental. Source versions and downloadable builds can differ; [installation status](docs/INSTALLATION.md) records current availability and verification limits. No production-ready release is currently advertised.

## Unreleased — Next

- Bundle offline Balanced world terrain with explicit unload/restore and custom-DTED replacement. Preserve its identity in portable workspaces without copying the world pack. Retain the idle-camera roundoff workaround and integrate the completed workflow/navigation changes below into Next main.

- Preserve the complete Event selection during slower double-click zoom, including off-screen Events and selections beyond UI limits. Guard restoration against newer selections, edits and workspace changes. Correct navigation QA to distinguish full selection from renderer evidence, and add delayed-click/query/export regressions.

- Add clickable Time and Map hero thumbnails for all six offline demos, captured from the actual saved views with source attribution. Add Sync views below the selection arrow: fit the active geographic area and heading into the other views, share tilt between Time and Globe, and let Map rotate while remaining flat. Preserve independent view cameras in portable workspaces and named views.

- Extend Time-view geography across the visible ground without moving the existing time-axis reference. Place four pickable grab spheres at viewport edges, clear of navigation overlays, and request imagery for the expanded footprint. Show the packaged version beside Chronoscope in native window titles.

- Improve demo-picker contrast and readability; arrange New analysis as suggested analyses on the left and task details/options on the right. Rename toolbar views to Time and Map. Add light/dark contrast and responsive master/detail regression checks.

- Add the welcome workspace with Open data, offline demos, actual recent saved workspaces, keyboard hints and an empty-workspace escape. Modal dialogs retain keyboard focus and return it when dismissed.
- Coalesce identical in-flight WMTS viewport requests and retain loaded imagery instead of publishing unseeded empty canvases. Use the native Metal backend for macOS map QA; both complete offline map suites pass locally.
- Add local guided profiles, duplicate groups, outliers and trajectory summaries, with explicit scope/layer/field choices, job progress/cancellation and persistent linked results. No SI connection is required.
- Stage imports through source selection, mapping and full-file quality review. Preserve drafts when returning to mapping, disclose location gaps and canonical duplicate candidates, require explicit rejection acceptance, and export complete rejected-row reports without publishing Events.
- Separate frontend import, analysis, map settings, table gestures, document file routing and operation jobs into focused modules; keep save/close serialization in the existing workspace controller.
- Add full-review, report-export, guided workflow and extracted-table regression coverage. These changes are development source in Next and have not been promoted to Public.

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
