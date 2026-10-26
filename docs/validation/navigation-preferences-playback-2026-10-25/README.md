# Navigation, preferences and playback controls

Implemented against `chronoscope-app/chronoscope-next/main` at `a1b9c89`.
Next's saved per-view cameras, Sync views, agent playback controls, guided
workflows and workspace/draft fixes are retained. Pending Next branches were
checked; the old retire-Apple branch's focused AI work is already integrated
in main through PR #2. This change is for Next only, with no public promotion.

- Time elevation uses one slider in Globe and Space-time. Zero is Off.
  Globe retains logarithmic positive scaling from 0.05x to 20x, with 1x at
  the midpoint. Zero Space-time height is validated and saved as zero.
- Preferences has General, Workspace, Display and Agent access categories on
  the left and settings on the right. Drafts survive navigation and native
  agent setup actions. Save applies every category; Cancel discards form edits.
- Redundant expand-workspace/export-canvas icons are removed. Existing pane
  rails remain available, and old expanded scenes migrate to reversible pane
  collapse. CLI/MCP screenshots are retained. Drag navigation uses a hand icon.
- The vertical time rail's playback popup has Fade, enabled by default.
  Departures fade over 800 ms (previously 2400); arrivals over 180 ms (550).
  Markers, entity tracks, ground trails and stems participate. Fade off retains
  current/subsequent playback history in a growing filtered window until the
  next loop; the map, table, selections and exact query scope agree. Re-enabling
  Fade while playing restores the moving window. Normal render budgets apply.
- Fade persists through scenes, named views and portable workspaces. Agents
  can use `view_set {"playback_fade":false}` or
  `view_playback {"action":"configure","fade":false}`. Playback status includes
  `fade`. Existing `globe_time` / positive `globe_time_scale` contracts remain
  compatible; the UI maps zero to `globe_time:false`.
- Afterimages remain visual-only and bounded to 100,000 points, 100,000 line
  segments and 256 GPU batches. More than 32 departing entity groups share a
  neutral history batch per stream; live entity colors remain unchanged.
  Queued elevation work is scoped to its workspace and invalidated by mode or
  workspace restoration.

## Verification

All checks ran locally; no GitHub runner was used.

- Production TypeScript/Vite build, generated Rust contracts and formatting pass.
- **31 Rust integration tests**: playback display, Cesium scenes, view/layer
  persistence and agent contracts. Covers zero height, invalid values, legacy
  defaults, named views, portable saves and CLI/MCP Fade discovery.
- Pure JavaScript checks cover moving/cumulative windows, live toggles, loop
  reset, full-range playback, all 100 Globe slider roundtrips and 1x midpoint.
- [UI report](ui-report.json): **11 checks** with the real Rust engine/Cesium
  frontend and 120 synthetic, second-spaced Events. Includes preferences drafts,
  keyboard navigation, both themes, narrow layout, zero-height save/reopen,
  unchanged coordinates/timestamps, legacy expansion migration, shared agent/UI
  Fade configuration, real playback retention, 800-ms cleanup and crowded batches.
- [Compass/navigation report](navigation-report.json): **14 checks**, including
  sliders, selection, narrow windows, attribute tables and public hurricane data.
- [Time rail report](time-rail-report.json): **13 checks**, including time-window
  interactions, playback controls, collapse, resize and persistence.
- [Globe report](globe-report.json): **3 checks** with independently calculated
  WGS84 normals, source-coordinate preservation, scale limits, camera retention
  and portable views. Slider zero remains enabled and returns Events to ground.

The captures are actual app UI screenshots, not generated concepts. Tests used
Linux Chromium software rendering and disabled public map requests. They do
not substitute for native macOS interaction/performance testing.
