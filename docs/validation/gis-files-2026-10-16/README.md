# GIS files and compact facets: local verification

Release: Chronoscope Prototype 0.14.0. Tests ran locally without GitHub runners.

- **222 Rust tests passed**, including seven GIS integration tests and five numerical centroid tests; strict Clippy and Rust formatting passed.
- **20 GIS browser checks passed** using the real Rust bridge and native Cesium loaders under the desktop content-security policy. All nine formats loaded; 3D Tiles content decoded to actual triangles. Exact IDs beyond JavaScript safe integers, XML description handling, table selection, repeated geographic-mode transitions, native CZML time, portable save/reopen, polygon geometry/centroid tracks and the centroid toggle passed. No public requests, uncaught renderer errors or CSP violations. [Report](gis-files.json).
- **29 broader browser checks passed**, covering coordinate references, navigation, selection, filtering, clusters/declustering, density, heat, bloom, terrain, imagery retention, Excel/CSV import/review, playback, analysis, saved groups, editing and history. [Report](regression.json).
- **WKT/WMTS integration passed**: polygon holes/picking and reopen, 64 local tiles, cache/offline reuse, multiple named servers, opacity/zoom rules and terrain retention; zero public requests. [Report](wkt-wmts.json).
- **14 native Tauri/WebKitGTK checks passed** through attached stdio MCP: polygon Event rendering/capture, all nine native format loaders, decoded 3D Tiles triangles, live model-scene capture and portable save/reopen. [Report](native-desktop.json) · [Current screenshot gallery](../../screenshots/current/README.md) · [Current screenshot gallery](../../screenshots/current/README.md).
- Packet decoder and display-math checks passed. Generated engine contracts match Rust. The production frontend and native Linux Tauri desktop binary build successfully. The bundled desktop executable passed headless CLI, agent setup and real stdio MCP discovery/query checks.

Chromium used SwiftShader on Linux; these results do not certify dedicated-GPU performance or native macOS/Windows WebViews. Fixtures and cached/local map services avoid public WMTS traffic. Sample GIS data is synthetic except the separately credited Khronos Box model. Native GIS references retain Cesium presentation semantics; explicit Events conversion supplies Chronoscope analysis and display controls. See [supported formats and limitations](../../GIS-FILES.md).

The screenshot shows full polygon Events at their UTC time heights, derived centroid circles and the connecting entity track. The hole remains part of the original polygon. Sidebar entries measure 24 pixels high with no category row margins; sorting, collapsing and list limits remain available. The coarse bundled Blue Marble is an offline reference, not detailed imagery.

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
