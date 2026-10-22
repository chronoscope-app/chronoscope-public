# Screen-relative pan directions — 2026-10-17

Pan arrows and unmodified arrow keys move displayed geography in the indicated screen direction: left/right change screen X; up/down change screen Y. Mouse drag gestures retain their existing behavior.

Previously the 2D/space-time camera translations moved the displayed map opposite the arrow. Globe used Cesium’s geographically constrained rotateLeft/rotateUp operations, so pan directions also changed with heading. Flat views now translate the camera opposite the desired screen displacement; Globe rotates around the camera’s current up/right vectors, preserving screen-relative directions at rotated headings.

Local production build and hardware Chromium checks use the real Rust bridge and 3,568 hurricane events. The regression projects a fixed ground anchor before and after each real button/key press, checks the sign and dominant screen axis, and checks selection preservation. All 56 cases pass: four directions × buttons/keyboard × space-time/Globe at 0°, 90°, 215°, plus 2D. No Cesium render or page errors occurred. Run with `npm --prefix frontend run test:pan-direction` and a local CHRONOSCOPE_CLI.

Native build, launch and UI verification are recorded in native-report.json. No hosted workflows are dispatched.
