# Map double-click selection investigation — 24 October 2026

Developed and verified locally in `chronoscope-app/chronoscope-next`, branch `codex/guided-analysis-import`, starting from `84f76626e2113915da3641952a77fb6f936c21d4`. No hosted workflow was dispatched and no Public promotion was performed.

## Findings

There were two separate issues.

1. **The originally reported timeout was a test error.** The test selected Events `1` and `2`, then waited for `view.selected` to contain both after Map zoom. Instrumentation showed that the engine still selected both records and the UI still reported two selected, while the refined render packet excluded Event `1`. The packet contained 164 markers and its selection evidence was correctly just `2`. `view_snapshot_v1.selected` is the intersection of the full selection with the current render/table/geometry evidence; it is not the complete workspace selection. Waiting longer could never satisfy the incorrect assertion.
2. **A related slow-double-click app bug was real.** After a single click's 250 ms feedback delay elapsed, the previous implementation restored `clickSequence.selection`, copied from the renderer's partial selection. If a previously selected Event was off-screen, restoring that partial list dropped it from the actual engine selection. A new regression against the archived pre-fix frontend reproduced a completed selection of only `2` where `1` and `2` should remain selected. This affects subsequent selected-only operations, not the underlying Event records.

## Fix

Canvas picking now uses a private engine-owned receipt for the complete pre-click selection. The frontend holds a rollback action rather than copying renderer IDs into a replacement-selection request. A slower double-click can restore the full set, including more than 20,000 selected Events, without transferring an unbounded list into the WebView or hitting the ordinary 10,000-ID `select` input limit.

The engine retains at most one canvas receipt. It is single-use, expires after five seconds, and is discarded on subsequent engine access after expiry or document replacement. Restoration checks the workspace identity, receipt revision, selection version and source-data version. A newer pick, explicit selection (even an identical set), saved-view/group restoration, edit or workspace replacement cannot be overwritten by an older receipt. Stale receipts are rejected before opening a transaction so they do not invalidate a newer receipt. Pick/restore operations do not add document Undo entries; dry runs neither apply a pick nor consume its receipt. The temporary backup is never serialized into portable workspaces.

Click sequencing uses the browser's `click.detail` recognition, allowing platform double-click timing beyond the old fixed 600 ms sequence window. The ordinary 250 ms single-click feedback delay is unchanged. Cesium suppresses compatibility `mousedown` events, so sequence tracking belongs on `click`, between the pointer-up feedback scheduling and the double-click cancellation.

Navigation QA now verifies the complete engine selection and the highlights for currently represented selected Events separately. The suite also checks that zooming back restores the selected markers, and that selected-only query and CSV export still use both records. Its Map camera checks compare visible orthographic framing (XY, direction/up and frustum width), not Cesium's internally recalculated camera depth. North-facing checks use the same small angular/wraparound tolerance appropriate to other rotatable views.

## Local verification

- **397 Rust tests pass**, including six new canvas-selection cases: renderer intersection vs. full selection; restoring 20,001 selected Events; stale/newer pick and selection intents; source edits and workspace replacement/Undo; saved-view restoration; receipt expiry; and non-consuming dry runs.
- **21 frontend unit cases pass.** Generated contracts, validation-suite inventory, Rust formatting and the TypeScript/production frontend build pass.
- The complete `navigation-qa.mjs` suite passes **14 checks**, including Globe, Time and Map mouse/wheel/keyboard behavior; fast double-click zoom; actual two-press double-clicks with 300 ms and 750 ms gaps; off-screen selection preservation; returning highlights; selected-only query/CSV export; additive selection; Escape; extreme navigation bounds; table keyboard selection; playback; and the shared CLI/MCP view adapter. It records no renderer errors and zero public HTTP requests.
- **Negative control:** the same off-screen, delayed-double-click regression fails against the archived pre-fix frontend, preserving only `2` instead of `1` and `2`. The corrected frontend passes. This demonstrates that the app regression is detected independently of correcting the original test assertion.
- Strict core and native Clippy pass. The macOS development bundle builds and passes strict ad hoc bundle verification. This is local development validation, not notarized distribution or cross-platform acceptance.

Local machine evidence is retained under `.qa/map-double-click-*` (ignored test profiles/logs, not shipped user data). The original diagnostic and negative-control failures are intentional retained evidence; the corrected complete navigation run passes.

The rebuilt native app also passes the run script's process verification and displays the normal Welcome workspace after its window is raised. No user records were open in the preview profile during the restart.
