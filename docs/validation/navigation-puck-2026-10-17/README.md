# Top-right navigation puck — 2026-10-17

The selected navigation-puck design replaces the separate compass/pan stack and zoom rail. One 120px-wide group sits 14px below and 12px inside the map’s top-right corner. Screenshot/expand actions sit alongside it; the legend stays at the left. Light/dark surfaces use existing app colors. Coarse-pointer devices retain larger controls.

- Drag the outer ring to rotate; N restores north. Ring-focused arrow keys rotate/tilt, Home restores north.
- Drag the inner disc or its centre to pan; four directional buttons also support click/hold. Screen directions match the arrows, including on rotated Globe views.
- The side rocker steps tilt or accepts dragging the angle, with keyboard arrows/Home/End. The eye in the base restores top-down.
- The attached base provides minus/plus, Fit and top-down; scrolling anywhere on the puck zooms. Duplicate bottom-toolbar zoom/Fit buttons are removed. Fit retains the previous full workspace/terrain refresh behavior and disables until complete.
- In 2D, tilt and top-down are hidden and heading rotation is disabled; pan/zoom/Fit remain available. Motion stops on release.

Local verification uses the real Rust bridge with 3,568 hurricane records and hardware Chromium: all three views, ring/pan/tilt drags, keyboard controls, wheel/buttons, selection preservation, hold/release, 24 independent Globe WGS84 ENU orientation cases, both themes, and top-right placement without overlap/clipping at 1600×1000 and 1000×700 with/without the table. Eleven groups pass. The independent 56-case pan-direction regression is also rerun.

Commands: `npm --prefix frontend run test:nav-puck`, `npm --prefix frontend run test:pan-direction`, and the workspace `script/build_and_run.sh --verify`. Native results are in native-report.json. No hosted workflows are dispatched.
