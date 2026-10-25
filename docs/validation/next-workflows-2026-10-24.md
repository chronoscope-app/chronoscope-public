# Next workflows, presentation and view navigation — 24 October 2026

> Follow-up: the Map double-click failure recorded below has been investigated and resolved in Next. It combined an incorrect full-selection assertion with a related slow-double-click app bug. See the [investigation and passing local checks](map-double-click-2026-10-24.md). The failure notes below retain the earlier validation state.


Development work in `chronoscope-app/chronoscope-next`, branch `codex/guided-analysis-import`, based on `97c7e4392d13727ad30f66d605b345b8042d2627`. This report covers the working-tree changes, not a Public release or an immutable release candidate. No hosted workflows were dispatched and no Public promotion was performed.

## Resulting behavior

- Analyze and Results → New analysis offer local profiles, duplicate groups, outliers and trajectory summaries. Scope, Event layer and fields are explicit. Rust jobs provide progress/cancellation; results retain provenance, exact linked Event IDs and portable persistence. Duplicate groups link to a labelled example Event rather than implying that one row represents the complete group.
- Imports use Source → Map fields → Review & import. Full-file review does not publish Events. It reports valid/rejected counts, missing spatial locations (including EMPTY geometry) and canonical duplicate candidates. Mapping drafts survive backward navigation; rejected rows require explicit acceptance. Report CSVs contain every rejected source row, reason and original source cell, with formula protection and atomic destination publication.
- Import, guided analysis, map settings, table gestures, document file routing and operation-job handling have separate frontend modules. Existing save/close serialization remains in WorkspaceController. Rust import dispatch/review lives in `engine/imports.rs`.
- The approved Welcome workspace design is implemented for empty unsaved sessions, with Open, offline demos, actual recent portable-workspace paths, clear-list, keyboard hints and an empty-workspace escape. Dialogs trap Tab and return focus on Escape. Recent paths stay local and are recorded only after successful Open/Save.

## Local verification

The local verification used Rust 1.99.0, Node 24.19.0, Python 3.12 and the installed macOS/Xcode toolchain. Dependencies stayed locked. Reports and screenshots remain in ignored `.qa` directories.

- Full Rust suite: **390 passing tests**. The five import-review cases cover complete rejection export beyond UI example limits, original source cells, formula protection, source replacement/overwrite refusal, file-root enforcement, source changes, cancellation, late committed-file cancellation and EMPTY geometry.
- Rust formatting and strict core/native Clippy pass. A callback type-complexity failure was fixed with a named lifetime-aware callback type; the strict core check was rerun successfully after that correction.
- Generated TypeScript contracts match Rust. Frontend production build and all **21 Node test-runner cases** pass. The maintained inventory contains 16 frontend unit suite files and 45 browser suites; this is an inventory, not a claim that every browser suite passed in this run.
- GLib static integrity and target-graph checks pass after prefetching the locked foreign-platform dependency sources. This is not a Linux GLib runtime test.
- New real Rust/Chromium workflow test passes: full import review, no early publication, rejection acceptance/export, preserved mappings, four guided analyses without SI, linked duplicate examples, portable save/open, keyboard ranges, local WMTS server/layer/opacity editing and compact/desktop layout. It records zero public requests and zero uncaught page errors.
- Existing analysis, Event-table, assistant, toolbar-dialog and workspace-boundary browser regressions pass. The broad Cesium regression passes, including Excel import, native/legacy Open routing, invalid-source dismissal, saved groups, edits/undo, fractional clocks, MGRS, ambiguity overrides, rejected coordinates and polar picking.
- Native Mac development bundle build and strict bundle verification pass. Native desktop CLI/agent/MCP smoke checks pass, including paths with spaces. This is not fresh-download acceptance, Developer ID notarization, Windows/Linux acceptance, physical GPU testing or physical smartcard verification.
- The separate first-run concepts pass desktop/tablet/mobile overflow checks, demo/help dialog interactions and Escape dismissal.

Reproduce the source/native gate with `python3 scripts/validate_local.py --native` after installing prerequisites and prefetching locked sources with `cargo fetch --locked`. Run `npm --prefix frontend run test:guided-workflows` for the new browser workflow, with `CHRONOSCOPE_CHROMIUM` pointing to an installed Chromium/Chrome executable. Use `./script/build_and_run.sh --build-only` for the local app bundle.

## Map failures resolved and welcome validated

Follow-up validation of this working tree resolves the two earlier failures:

- `basemap-qa.mjs` now uses native Metal on macOS, matching other Mac browser suites. The SwiftShader run closed the browser during a globe transition. The complete offline suite passes on Metal: all three views, alignment, Streets toggling, disk-cache reuse, custom settings and strict CSP. This establishes local Metal behavior; it does not establish SwiftShader globe reliability on macOS.
- `wkt-wmts-qa.mjs` passes in full on Metal, including all 64 provider tiles, concurrent identical reloads with opaque seeded continuity, cache/offline reuse, named servers, transparent alternate imagery, multiple layers/opacity, zoom visibility, WKT holes/picking/multipart rendering and reopen. Identical viewport loads now share their in-flight work rather than cancelling each other; direct refreshes complete the viewport, and empty unseeded canvases cannot replace loaded imagery. The explicit full-extent 64-tile coverage check remains independent of camera aspect ratio.
- `welcome-qa.mjs` passes: real Open/import cancellation, bundled demo picker, Tab containment and Escape focus return, empty recent list, missing recent-file error handling, actual recent-file Open, successful Save registration, persistent paths/counts and reload. It captures light/dark and desktop/compact layouts with no welcome-surface overflow, public requests or uncaught page errors.
- Guided workflow, toolbar-dialog, empty-workspace and complete real-demo regressions pass after welcome integration. Frontend production build, TypeScript and 21 frontend unit cases pass. The native Mac development app builds and passes strict bundle verification. The prior full Rust/Clippy/native smoke results above remain applicable; this follow-up changes frontend behavior and browser QA rather than Rust.

The final app was built and launched with `./script/build_and_run.sh --verify` using a fresh `.qa/native-next-preview` test profile. The running bundle passed process verification; native accessibility inspection confirmed the Welcome workspace and Analyze controls, and its window was raised for testing.

All work remains in Next. No hosted workflow, Public push, release or promotion was performed. This is local development verification, not notarized distribution or cross-platform release acceptance.

## Presentation follow-up

- Toolbar labels are **Time**, **Map** and **Globe**, retaining existing serialized mode keys and shortcuts.
- Demo picker uses opaque theme-aware cards, larger titles/descriptions, explicit Open actions and expandable source/license details. The real-demo suite passes after the change.
- New analysis uses a left suggested-analysis list and a right description/output/scope/options pane, stacking on narrow windows. Existing end-to-end checks still calculate all four analysis types successfully.
- `presentation-ui-qa.mjs` passes light/dark checks for 4.5:1 minimum title, description and action contrast, all six demo entries, source disclosure, task switching, left/right positioning and compact-window overflow. Frontend build, the native Mac bundle with strict signature verification, and 21 unit cases pass.
- Four separate interactive Time-view concepts explore continuous geographic context, scene-attached versus screen-fixed time scales and grab-sphere placement. They use illustrative sample tracks and the bundled public-domain Natural Earth imagery; they do not replace the live renderer. Older events remain above newer events, matching the app. Orbit, time-height, scrubbing, visibility and responsive behavior are locally checked.

## Expanded Time-view geography and versioned titles

The map now extends across the visible geographic ground, while the original inset reference calculation continues to position the UTC axis and focus tick. Four grab spheres move to viewport edges and avoid covering controls; above the natural horizon or at world limits they fall inward to valid geographic ground. Imagery requests follow the actual expanded ground frustum rather than the reference rectangle. No Event coordinate, time, time-height scale or stored camera format changes.

`space-time-window-qa.mjs` now explicitly checks unrestricted geography, expanded imagery bounds, the exact original inset axis origin, four pickable/unobstructed edge handles and existing zoom, bearing/tilt, continuous drag, pan, resize, all-mode, portable save/reopen, source-coordinate retention and stationary-render behavior. The full suite passes. Both local map-provider suites also pass. Versioned native titles use package metadata, with the corresponding version in browser page titles. Native check, strict native Clippy and the sealed Mac bundle build pass; native accessibility inspection confirms the visible title “Chronoscope 0.15.2”.

No terrain dataset was added or enabled as part of this change. Bundling terrain remains a choice between a compact global overview, a detailed regional starter pack and a combination of the two. The existing loader accepts WGS84/MSL DTED Level 0–2, indexes headers lazily, and caps a folder at 2,048 tiles; a whole-world overview needs preprocessing and a suitable compact loader rather than simply dropping a global DTED directory into resources.

Follow-up checks: the 21 frontend unit cases, native formatting/check/strict Clippy and sealed macOS bundle pass. The local DTED integration passes its four normal Time/Globe/Map/Time transitions on Metal, including actual terrain intersections, seams and imagery. The current native app was inspected with the wildlife demo: title reads Chronoscope 0.15.2, geographic ground reaches the viewport perimeter, and the original inset UTC axis remains visible.

A separate broad `navigation-qa.mjs` run passes Globe and Time interactions but times out at the Map-mode double-click selection reconciliation assertion (line 304 at the time of this run). The exact assertion also times out using the archived unchanged starting frontend (`.qa/baseline/frontend/dist`) and the same local engine/Chrome. This broader suite is not reported as passing; it is an existing Map-selection regression-test failure, separate from the targeted expanded Time-view checks. Navigation QA now accepts an optional frontend directory for repeatable baseline comparisons. Terrain QA uses Metal on macOS, consistently with the other local map suites.

Terrain source references reviewed: [USGS GMTED2010](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-global-multi-resolution-terrain-elevation) and [USGS SRTM](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1). Packaged terrain would need a relocatable resource lookup, explicit known vertical datum, startup fallback and preservation of user/saved-workspace terrain choices. No terrain download, redistribution or startup-default change was performed.

## Demo hero previews and one-shot view sync

All six demo cards now contain actual Time and Map renderer captures. Clicking a thumbnail opens its corresponding saved hero view; the main Open action opens Time. The twelve shipped JPEGs total about 350 KiB, with dataset attribution, capture state and SHA-256 hashes in `frontend/public/demos/manifest.json`. Capture runs use isolated profiles, the bundled Natural Earth reference map and no public HTTP requests. Native inspection confirms that these local image URLs also load in the Tauri app. Redundant card-body tooltips are disabled; thumbnail buttons retain descriptive accessible names.

Sync views sits immediately below the selection arrow. It copies the active geographic focus, visible ground area and heading into the other projections; Time and Globe also share tilt, while Map remains flat and can rotate to the synced heading. Each projection fits the source footprint rather than reusing incompatible camera vectors. An Earth overview whose corner rays miss the globe uses conservative geographic bounds. This is a one-time operation: subsequent adjustments stay independent. Visited cameras and unvisited synced destinations survive portable save/reopen and named views. Opening a different workspace clears the preceding view cache. Home on the compass and N in the map restore north.

Local checks for this follow-up:

- **391 Rust tests passed**, including per-view navigation validation, save/reopen, invalid coordinates/headings/tilts/camera vectors and explicit Fit clearing the target cache. The 21 frontend unit cases pass.
- Strict core and native Clippy, Rust formatting, TypeScript/production builds, generated-contract drift and the validation inventory pass. The new browser suite is part of the normal local inventory.
- `view-sync-qa.mjs` passes all three source directions; unchanged active camera/data/filter/selection; independent adjustment retention; unvisited synced destinations after save/reopen; date-line/high-latitude framing; Earth-overview bounds; rapid mode switching; and Map compass Home restoring north. The source's visible ground corners remain inside destination viewports. No public HTTP requests or renderer errors were recorded.
- Presentation QA passes both themes, minimum 4.5:1 text/action contrast, all twelve loaded hero images, corresponding Time/Map thumbnail actions, source disclosure and existing responsive analysis layout checks.
- The final native development bundle builds, passes strict ad hoc bundle verification and launches through `script/build_and_run.sh --verify`. Native UI inspection confirms the versioned title and real demo thumbnails. This remains a local development build, not a notarized or cross-platform release.

The broad navigation suite still times out at its existing Map double-click selection reconciliation assertion (line 304); the earlier unchanged-frontend comparison is documented above. It is not reported as passing. Chrome also exited during reused large-demo GPU sessions on this Mac; the extended Time and demo suites now isolate a fresh browser for each large dataset while retaining their original rendering, source-preservation, interaction and playback assertions. This test isolation does not establish a fix for Chrome GPU lifecycle behavior.

Final sequential runs with per-dataset browser isolation: the complete extended Time suite passes **18 checks**, and the complete real-demo suite passes **21 checks**, including original observations/saved views, all three render modes, numeric attribute-table ordering, playback and restoring the saved bloom view. No original assertions were removed. The final native app was rebuilt after the accessible-card-label/tooltip adjustment, passed strict bundle verification and process checks, and was raised with the demo picker open for user testing. The only remaining failed broad suite in this follow-up is the separately documented baseline Map double-click assertion.
