# Cesium CLI/MCP verification — 0.14.1

All checks ran locally; no GitHub runners were used.

- **230 Rust tests passed**, including seven new Cesium-agent integration tests and the SI presentation-grant test. Strict core Clippy (`--all-targets -- -D warnings`), formatting and generated contract checks passed. [Engine summary](engine-checks.json).
- **24 GIS/agent browser checks passed** using the real Rust bridge and Cesium under desktop CSP: nine native formats, actual decoded tiles, portable assets, exact/multipart source IDs, attribute selection, centroid Events and three geographic look-at projections within one CSS pixel of the viewport centre. No public requests, renderer errors or CSP violations. [GIS report](gis-agent-browser.json).
- **29 broader UI checks passed**, including native picking, modes/zoom, linked tables, filters, density/heat/bloom, terrain/imagery, imports, playback, editing and history. No browser/script errors or CSP violations. [Regression report](regression.json).
- **15 native Tauri/WebKitGTK checks passed** through attached stdio MCP and the bundled CLI: live backend/API inspection, geographic camera centring in 2D/Globe/Columbus, exact 2D zoom width, north-up, partial-setting/camera preservation, GIS layer fitting, ergonomic CLI commands, atomic PNG saving with a spaced path, overwrite protection and existing MCP image capture. [Native report](native-desktop.json).
- Production TypeScript/Vite and native Linux desktop builds passed; the bundled headless CLI/MCP launcher smoke checks passed.

The native runtime reported WebGL2 with `webgpu_api_available:false` and `hardware_acceleration:unknown`. Browser tests used SwiftShader; native Linux used software WebKitGTK/llvmpipe. These are functional checks, not physical-GPU FPS or native macOS/Windows certification. Public WMTS sources were disabled.

The broad suite initially exposed Cesium's competing default left-click imagery picker: it attempted a ray intersection in Columbus mode and threw `DeveloperError: Ray intersections are only supported in 3D mode`. Disabling that default picker resolved the exception; Chronoscope owns linked selection. The permanent suite now preserves original browser error details so minified class names do not hide future causes.

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
