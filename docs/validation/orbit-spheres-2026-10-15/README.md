# Sphere drag direction

Both sphere-drag axes were inverted. The old control changed heading by +12 degrees for a 40 CSS-pixel left drag. The fix reverses the heading and tilt increments so left/right turn that way and up/down tilt in the corresponding direction. Existing sensitivity, tilt limits and camera orientation mathematics are retained.

The production TypeScript/Vite build passed. An actual Chromium/SwiftShader pointer test GPU-picked each of the north/south/east/west spheres and dragged it left, right, up and down: all 16 cases passed. Left/right changed heading by -12/+12 degrees; up/down changed tilt by approximately +6/-6 degrees. Every release restored background camera input and left event selection unchanged. No page errors or external map requests occurred. See `report.json`.

This verifies Linux software WebGL and the pointer input path; the rebuilt Mac app still needs local feel testing.
