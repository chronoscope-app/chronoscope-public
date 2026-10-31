COMPACT MAP CONTROLS AND AUTOMATIC GRAPHICS — WINDOWS

Source: fe83907576c099e283485cfb57eed048bc1f71f5, Chronoscope Next 0.16.10.

Radius selection now uses a compact popup beside the pointer, with no full-screen overlay or blurred background. Coordinates are expandable. Escape, Cancel and outside clicks dismiss it without changing selection. Radius validation and exact WGS84 selection work in Map, Time and Globe.

The graphics switch and its reserved bottom row are removed. Smooth rendering is automatic when supported; the resource governor reduces work under pressure and restores quality with headroom. Unsupported representations use the standard renderer. An old saved off setting does not disable this automatic behavior.

The UAV box is a measurement color legend: the demo's saved scenes enable Color by value for 0–60 m height above takeoff. Its small × hides it without changing the color scale, source records or physical height settings. The choice survives refresh, view changes and reload for that scale. Restore it in Views → Color by value → Show color legend on map.

Verification: production build, all 175 frontend tests, nine browser suites, optimized Windows desktop build and four attached native checks passed. The governor was exercised with injected critical pressure and real recovery time. Native KABR/Map/Time/Globe captures show the close button and removed bar; automatic native navigation and cross-view playback passed. See report.json for exact suite names, checks, hashes and limitations.

Direct Windows input automation was unavailable because the helper could not resolve usable control geometry and its capture was occluded. Native WebView2 capture/MCP and browser mouse/keyboard checks passed. Rust/native host source and locks are unchanged from the previously tested backend. Initial test assumptions were updated for automatic rendering and collapsed coordinates; raw attempts remain under ignored .qa/compact-controls.

This work updates Next and the local Windows build. Public, download assets and manual-only workflows are unchanged.
