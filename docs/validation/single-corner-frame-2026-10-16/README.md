# Single-corner space-time frame

The enclosing cube, repeated side-wall bands and rotation-handle tethers are removed from space-time. One northwest reference corner supplies a time axis and two faint ground edges. At most four short labelled ticks appear on the axis. Playback uses a short accent tick at its actual time position; the four draggable rotation spheres remain available. The coordinate label describes the same northwest origin and is offset to avoid the western sphere. Calendar retains its existing reference frame.

Local visual verification used actual Cesium WebGL2 and the Rust engine in Chromium/SwiftShader on Linux. Polygon Events, centroid circles and tracks were inspected in both dark and light themes; 3,568 real NOAA Atlantic hurricane Events were inspected with their entity tracks. No public map requests or uncaught renderer errors occurred. The production frontend and Linux Tauri binary build, and the existing time-axis numerical/formatting checks pass. All 29 checks in `npm --prefix frontend run test:cesium` passed, including geographic-mode transitions, playback, picking/selection, import review, density/heat/bloom and terrain/imagery retention. [Regression report](regression.json). Physical macOS/Windows GPUs were not tested.

[Current screenshot gallery](../../screenshots/current/README.md)

[Current screenshot gallery](../../screenshots/current/README.md)

[Current screenshot gallery](../../screenshots/current/README.md)

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
