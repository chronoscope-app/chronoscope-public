# Compact navigation — local validation, 2026-10-17

The Compact Earth stack replaces the basic compass. The upper disc controls heading and tilt; N restores north-up, and its central eye restores top-down. The lower pad pans, with a fit-frame icon at its centre to fit visible events. A logarithmic vertical rail and +/− control zoom. There are no North up, Top-down, or redundant Fit footer buttons. Existing N/U/F/R keyboard shortcuts are retained with map focus; fields, tables, and sliders keep their own keyboard handling.

Hold arrow and zoom buttons to repeat steps; release, cancellation, or losing window focus stops immediately, without inertia. The compass ring still rotates in the established direction and its cardinal letters remain upright. 2D disables heading/tilt controls and retains pan, fit, and zoom. Light/dark surfaces remain opaque. The legend moves to the upper left; a short scene lays the same controls out horizontally to keep them accessible with an open table.

The work also fixes Cesium lookAt's loss of heading at exact nadir. The requested ENU right/up vectors are preserved before leaving the focus transform. Globe heading/tilt now use the same ground-focus frame as their setters, rather than the different frame beneath an orbiting camera. With no terrain, the focus uses exact WGS84 ellipsoid intersection to avoid coarse globe-mesh errors near nadir/polar locations; terrain still uses the actual surface.

## Local checks

- TypeScript/Vite production build passed.
- Nine Compact integration groups passed through the real Rust HTTP bridge and hardware Cesium rendering, using 3,568 hurricane events.
- N click/key, eye/U, fit, rotate/tilt arrows, ring direction, pan, zoom buttons and slider passed in Space-time/Globe/2D.
- Twenty-four independent ENU heading/tilt cases passed at equatorial, mid-latitude, southern and high-latitude locations, including exact top-down.
- Hold/release preserved selection and stopped immediately. Light/dark and 1600×1000 / 1000×700 layouts, including the open attribute table, passed with no control clipping or overlay collisions.
- The existing 13 navigation groups cover gestures, keyboard focus, additive selection, time invariance, bounds, and the shared CLI/MCP adapter.

- Native bundle built and signature verified. Actual native UI checks confirmed N click (42° → 0°), the eye (48° → 0° tilt), pan-centre fit, and keyboard N (15° → 0°). Full hurricane range is visible with 3,568 events and no renderer errors.

All checks are local; no hosted workflows were dispatched. Native build and live verification records are retained in the workspace QA directory.
