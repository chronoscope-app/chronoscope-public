# Terrain flashing during navigation: Mac validation, 2026-10-25

The previous terrain tests waited for refinement to finish and therefore missed
blank ground while the camera was moving. The new regression failed against the
existing build: a brief navigation sequence rendered 44 frames, including 12
with no ground tiles. The terrain provider had been replaced during the sequence.

Every viewport terrain packet previously installed a new Cesium terrain provider,
discarding its terrain and imagery quadtree. The fix retains one provider for a
terrain catalog. Cesium requests native elevation grids per terrain tile, keeps
existing tiles during refinement, coalesces repeated requests, and limits native
loads to six at once with a 64-tile provider cache. CPU height sampling for Events
and axes still receives viewport updates. Catalog, datum, exaggeration and unload
changes continue to replace terrain deliberately; renderer recovery retains the
source adapter. Crossing the date line and leaving custom coverage no longer
clear the installed catalog during navigation.

## Verification

- 46 focused Rust tests; 29 frontend unit tests; 8 runner regression tests.
- All 11 map/navigation browser suites, including real terrain, custom DTED,
  WMTS, polar scenes, viewport loading, view sync and navigation controls.
- Movement regression uses keyboard pan/zoom, an actual mouse drag, and wheel
  zoom in all three views. It samples each rendered frame. The fixed build
  recorded 157 frames with **zero** terrain-provider replacements and **zero**
  empty-ground frames (Globe 39, Map 67, Time 51).
- New unit assertions cover tile source sampling, concurrent-request coalescing,
  quadtree/cache retention, CPU sampler updates, bounded outstanding requests,
  and explicit source/exaggeration/unload invalidation.
- Packaged Mac build/signature verification, native CLI/MCP smoke, and 13 native
  GUI checks pass. Native pan/zoom preserves the provider in Globe, Map and Time;
  real terrain, idle rendering, custom DTED, polar coverage and save/open pass.
- Native wheel input and mouse dragging also exercised through CUA in the loaded
  app with the public wildlife dataset. The rebuilt app remains running.

The first extended headless Chrome/Metal terrain run closed in its separate polar
case; that group now starts with fresh browser resources after the continuous
three-view navigation group. The initial native movement fixture requested a
nonzero Map tilt and was corrected to the supported zero tilt. Original failures
remain in local evidence; neither was counted as passing.

Commands (local toolchain environment loaded):

```sh
python3 scripts/validate_local.py --suite balanced-terrain --skip-build
python3 scripts/validate_local.py --suite balanced-terrain --suite cesium-terrain --suite space-time-window --suite viewport-pan --suite display-recovery
python3 scripts/validate_local.py --feature maps --feature navigation --native-gui
python3 scripts/validate_local.py --suite balanced-terrain --skip-build --native-gui
```

[report.json](report.json) records before/after measurements, native navigation
samples, run IDs and source hashes. Raw logs and captures remain under
`.qa/map-flashing/runs/` on this Mac. This is focused verification of the fix;
a full release sweep, heavy benchmarks and other operating systems were not rerun.
No GitHub runners were used.
