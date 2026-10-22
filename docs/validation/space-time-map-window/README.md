# Space-time map window — local verification

Space-time now derives its geographic map floor from the native Columbus camera
and viewport, rather than clipping it to the original dataset extent. Dolly/wheel
zoom changes geographic coverage while retaining a large map footprint. Insets
reserve space for the time axis, labels, navigation rail and four grab spheres.
The window follows pan, bearing, tilt and resize; finite world edges can limit it.

The calculation fits an axis-aligned geographic rectangle inside the projected
inset, including perspective, near/far clipping and WGS84 world limits. It uses
Cesium's native geographic projection and world axes. Event coordinates, stored
study bounds, timestamps and time-height scale are unchanged. Fit targets the
study, never the expanding window. Imagery/terrain resource requests use the
window; elevated-Event culling continues to intersect the entire time prism.
No new workspace fields are needed: restoring the native camera derives the
window for the recipient's viewport. Stationary frames reuse the floor and axes;
zoom does not rebuild Event geometry just to resize the map.

## Checks

- Production TypeScript/Vite build passed.
- `npm --prefix frontend run test:space-time-window` passed: 988 numerical checks
  across six bearings, six tilts (including nadir), three viewport sizes, an
  elevated terrain plane, world edges and invalid inputs. An 8× zoom preserves
  projected corners while geographic extent grows 8×.
- [Browser report](window-report.json): nine checks against the real Rust engine
  and Cesium frontend with 3,439 public animal-GPS Events. Includes 20 camera
  orientations, four visible handles, real scroll-wheel cursor anchoring,
  pan/resize, Fit after zoom, Globe/2D/Calendar transitions, portable save/reopen,
  unchanged source values/geometry generation and reuse on stationary frames.
  The 8× zoom changed corner positions by less than 0.1 CSS pixels.
- [Pan regression](pan-report.json): 56 API/keyboard direction cases passed.
- [Street basemap regression](basemap-report.json): native tile alignment,
  all three geographic views, toggling, offline cache reload and desktop CSP
  passed using the existing offline vector fixture.
- [Terrain regression](terrain-report.json): real public N43 DTED and a cached
  georeferenced EOX/Sentinel tile passed Space-time → Globe → 2D → Space-time.
  Nine top-surface/off-seam ray probes per view match the source within 3 metres.
  EGM96 is an explicit test assumption for the source's generic MSL header.
  Zero public tile fetches were needed. A first run against a reused test profile
  failed the Globe detail check; both unchanged baseline and this revision passed
  with clean profiles. New window tests use a disposable profile per run.
- Existing Cesium geometry and UTC time-axis tests passed.

All verification ran locally on Linux/Chromium with software rendering. These
checks establish geometry and interaction behavior, not hardware GPU throughput
or native macOS/Windows performance. No GitHub runner was used.

## Actual app captures

[Current screenshot gallery](../../screenshots/current/README.md) and [Current screenshot gallery](../../screenshots/current/README.md)
show the same public Black Rock Forest bobcat/fisher Events with the real default
OpenFreeMap/OSM street map. The wider view shows more surrounding towns while the
floor and grab spheres retain their screen positions. These are unretouched app
captures, not generated concepts. Public basemap requests used the normal private
cache with two concurrent requests and a 250 ms interval for this capture only.
The first cold-cache capture attempt timed out; the cached retry completed with
46 rendered tiles, no final basemap error and less than 0.1-pixel alignment error.

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
