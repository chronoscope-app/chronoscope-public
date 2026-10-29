# Next 0.16.2: stable attribute tables during playback

Validated application source: `c6a5b64e91bc675cb82116334942acd5d454f3db`. The [verification receipt](verification.json) records the installed binary hash. App and bundle metadata read **0.16.2**; Tauri core remains **2.12.5**. The strict-signature-verified local debug bundle is installed at `~/Applications/Chronoscope.app`, with one Chronoscope copy in that directory.

## Reproduction and fix

The [before report](before-report.json), against preceding Next/main `d128bfe`, reproduced both symptoms during real moving-window playback: a hovered Event row, header, close button and column element were disconnected by refreshes, and a held close click failed while playback continued.

Table tabs, headers and column geometry now retain their DOM elements when their markup is unchanged. Event and GIS rows reconcile by exact record ID, retaining unchanged rows while adding, removing, reordering or updating changed rows. Hover and keyboard focus can survive live updates, and mouse-down/mouse-up reach the same close control. Tables that ignore workspace filters and timeless GIS tables no longer reset their scroll/selection anchors on every timeline tick. Row publishing reads the live scroll position after asynchronous requests, avoiding restoration of stale coordinates.

The [playback regression](playback-report.json) passed for docked and detached Event and GIS tables. Each scenario advances several workspace revisions, verifies retained controls and hovered row identity, checks nonzero scroll retention, holds the close pointer down across updates, and confirms the table closes while playback remains active. A fifth check proves filtered table rows continue changing and match the exact Rust table after pausing. The scroll check dispatches the table's scroll event directly; hover and held close use browser pointer input.

The broader [Event-table](event-table-report.json) and [detached-table](detached-table-report.json) suites passed, covering sorting, selection ranges, keyboard focus/reveal, paging, original attributes, table search, column windows, tab switching and detach/dock. **150 frontend tests**, **20 validation-runner tests**, **5 version metadata tests**, actual metadata consistency, generated contracts and production frontend/native builds passed locally.

## Native Mac check

Using a disposable native WKWebView profile with 3,568 hurricane Events, CUA pointer input held the close button for **1.5 seconds** while the moving time window continued to advance. Both the unfiltered table and a newly opened table respecting workspace filters closed successfully. Full native accessibility snapshots showed the close control absent and **Pause still on** afterward. The installed executable's attached MCP independently confirmed playback remained active and reported zero renderer errors; the QA profile was then paused. [Native receipt](native-report.json).

Validation ran on Apple M5 / macOS 27.0.1, with Chrome Metal browser checks and native WKWebView. This establishes interaction correctness and retained DOM identity, not a measured FPS improvement. No hosted workflow was started and no public promotion occurred. Windows/Linux native behavior was not checked.

## Reproduction commands

```sh
cargo build --locked -p chronoscope --bin chronoscope
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run test:table-playback
node frontend/scripts/event-table-qa.mjs
node frontend/scripts/detachable-tables-qa.mjs
```

Run heavy checks sequentially under `scripts/guarded_run.py` on this Mac, sourcing `.local-build/env.sh` when using its local toolchain. Build/install through `script/build_and_run.sh --verify`. Browser checks create disposable profiles and use local HTTP fixtures against the actual Rust engine; they do not use the normal user workspace.
