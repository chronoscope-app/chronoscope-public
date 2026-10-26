# Detachable attribute tables and SI chat — 26 October 2026

Developed from Next main `57c5bb2`, after fetching origin and checking pending
Next branches. The recent demos, Windows validation fixes, guided analysis and
focused AI work are present. No Public promotion or hosted workflow was run.

Event sources, all-source tables, display-cell tables and GIS reference layers
share one tab group. Reopening a layer activates its existing tab. Each tab keeps
its sort, filter/search scope, source-column page, row/column scroll position and
selection anchor for the session. Tabs support arrow/Home/End navigation and
individual close buttons. Removing a GIS layer removes its tab.

**Detach** moves the entire group to one native, movable, resizable utility window.
Opening another table while detached adds its tab to that window. The original
continuous table renderer and exact selection operations are shared by both
locations. **Dock** and the native window close button return the group to main;
closing the last table closes the utility surface. The main workspace owns the
session's tab state, including after a detached-page reload. Workspace changes
invalidate stale tab state; restoring a scene in the same workspace retains the
other open tabs. Saved projects continue to use the existing active-table scene
fields. Additional tabs are kept for the session; projects do not save detached-window placement.

SI's existing separate-window implementation now has a visible **Detach** label
and updated help. Drafts, conversation history and active requests remain in the
shared Rust chat session. The native app's close lifecycle includes both utility
windows, so neither becomes an orphan workspace.

## Local verification

- Frontend TypeScript/production build and 70 frontend unit tests pass.
- Six focused Rust table/selection/view tests pass. Native desktop compilation and strict Clippy pass; Rust formatting and the
  validation-suite inventory pass.
- The focused table browser suite passes all 10 checks against the real engine:
  per-tab state, deduplication, detachment, linked Event/GIS selection, docking,
  native-style close, GIS search/sort, reload, removed layers, scene restoration,
  and closing the last detached tab.
- The existing Event table suite passes all 14 checks in a visible Metal browser,
  including full canonical/source columns, exact range selection and keyboard
  reveal across virtual pages. An earlier headless Chrome process crashed after
  its first 10 successful checks; the completed visible run is retained separately.
- SI rich-chat checks pass with the local mock service, including draft handoff,
  running requests, docking, close/reopen, rich results and attachments. No external
  service request is made by that suite.
- `script/build_and_run.sh --verify` builds, ad hoc signs, verifies and opens the
  local macOS bundle using an isolated test profile.
- Native macOS UI checks directly verify the two-table tab group in a detached
  window, both tabs returning on Dock, and SI chat detaching with its typed draft.

[Table browser report](tables.json) · [Event table report](event-table.json) ·
[SI chat report](si-chat.json)

Detailed logs and disposable profiles stay in ignored `.qa/`. This verifies local
macOS behavior; Windows and Linux native windows were not exercised in this task.
