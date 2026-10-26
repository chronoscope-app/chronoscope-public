# Linux validation — 26 October 2026

**Fresh Clawcomp selected gate: PASS. Public promotion: ON HOLD.** These results apply to the frozen existing UX, not the incoming continuous-column/per-table-search changes.

Tested implementation `a8bc62a4b4b5cf1628ebea5aa573e84df842f24e`, fetched Next main `fb9cee26288a45ffba77de7ee4823326387238fd`, then frozen test revision `73eaf077a2e86b1e56d34dc4b87314213b076493` on `codex/linux-detachable-tests-20261026`. The latter adds only three browser assertions; production source is identical. The coordinator requested the branch for adaptation/integration and explicitly held Public promotion. Public remains `3e5cbe6a84d1498f79efb8b5d6102f85cf47633b`.

- Complete core Rust matrix, including ignored cases: **422 passed, 0 failed, 0 ignored**, 657 seconds. The six table/view cases also passed in the focused build gate.
- Frontend production build and **70 units**; **39 Python checks**; formatting, strict core/native Clippy, generated contracts, inventory and normal release metadata: PASS.
- Fresh CLI and desktop build plus real desktop CLI/MCP smoke: PASS. Relocated SDK uses both package-config directories; the prior setup failure did not recur.
- **60 unique browser checks**: expanded detachable tables **13**, existing Event tables **14**, GIS files **24**, SI rich chat **9**. No page errors/public requests; SI used exactly six deterministic loopback service calls. Chromium launched with Intel-only Vulkan configuration.
- **Nine actual native GTK/WebKit checks**: two-tab group detachment, linked row selection, native move/resize, Dock, native window close, last-tab closure, SI draft detachment, docking and native close/return. The successful session used private Xvfb and no GPU devices exposed. Native active requests were not exercised; that behavior is covered by the separate browser suite.

The added tests cover source-column paging and both scroll axes, independent selection anchors, and exact display-cell membership across tab/window changes. The current paging-button assertion must be adapted for the new UX; no shared product or QA files were edited after the coordinator's freeze instruction.

[Machine-readable receipt](clawcomp-result.json) · [Native fixture source](clawcomp-native-session.py) · [Native detached tables](clawcomp-native-table-detached.png) · [Native table close/return](clawcomp-native-table-close-return.png) · [Native SI draft](clawcomp-native-si-detached-draft.png) · [Native SI close/return](clawcomp-native-si-close-return.png)

Commands used the shared guard (one Cargo job, one Rust test thread; heavy runs serial). The maintained gate ran `validate_local.py --suite detachable-tables --suite event-table --suite gis-files --suite si-rich-chat --rust-test table_selection --rust-test views_layers --native`, followed by the full Rust command above and the expanded `--skip-build --suite detachable-tables` run. Exact commands, run IDs, hashes and limitations are in the receipt; raw logs/profiles remain in `.qa/detachable-linux-2026-10-26/`.

The first native fixture configuration failed before GUI launch; an initial graphics session was stopped after failed AMD initialization probes despite software settings. Both attempts are retained locally. The completed native pass used a private device namespace hiding all GPU devices. Headless portal/PipeWire and existing vendored GLib warnings are not hidden. This does not certify native hardware rendering, GNOME/Wayland, Windows, Mac, all 52 browser suites, release packages or performance. No Public source, binaries, tags, releases or hosted runners changed. The exact-candidate secret scan was not completed after promotion was held; a fresh unchanged-config scanner canary did pass.

## Earlier partial run

The earlier incomplete receipt below and its JSON files are retained unchanged as historical evidence. They are not counted as fresh pass results.

### Original partial receipt — 26 October 2026

**INCOMPLETE — stopped at the coordinator’s request to avoid a duplicate cloud run. This receipt does not pass the Public promotion gate. No Public changes or GitHub runners were used.**

Exact tested source: `a8bc62a4b4b5cf1628ebea5aa573e84df842f24e` from `chronoscope-app/chronoscope-next/main`. Fetched pending branches before building; the only pending Next branch was `codex/retire-apple-si-chat`, whose focused AI work was already integrated via PR #2. Existing work was preserved in a separate worktree. No implementation files changed.

## Completed

- Fresh real-engine CLI build and frontend TypeScript/Vite production build: PASS. Vite emitted its existing large-chunk advisory.
- Frontend unit tests: **70 passed**, none failed/skipped.
- Required browser suites: **57 passed**, no page errors or public requests. Chromium on Linux used software SwiftShader; these are browser utility windows, not native Tauri window tests.
  - Detachable tables: **10**, including deduplication, sort/filter/scroll retention, linked Event/GIS selection, opening GIS while detached, Dock, browser-window close, reload, removed layer, same-workspace scene restore and last-tab closure.
  - Event table: **14**, including exact sorted/range/keyboard selection, source columns and column paging, hidden sources and GIS properties.
  - GIS files: **24**, real Cesium loaders and bundled fixtures, desktop CSP.
  - SI rich chat: **9**, draft handoff, active-request detach/reload/close/reopen, no duplicate calls, rich results, linked selection, cancellation and reset. Only the local deterministic mock service was used (6 expected calls); no external AI calls.
- Generated contracts and Rust formatting: PASS.
- Suite inventory: PASS (26 unit scripts, 52 browser suites, 3 performance suites, 1 experimental suite).
- Python checks: **39 passed** (guard 6, validation runner 20, GLib integrity 5, workaround integrity 3, release preflight 5).
- Both GitHub workflows remain manual `workflow_dispatch` only.

## Incomplete and setup warning

Native strict Clippy was attempted with the existing relocated SDK. It stopped at `gdk-sys`: the SDK’s `usr/share/pkgconfig` was omitted from the search path, leaving `xproto` unresolved. This is a host dependency setup failure, not an established product defect. The likely next setup step is to include both SDK `usr/lib/x86_64-linux-gnu/pkgconfig` and `usr/share/pkgconfig`; it was not retried because the coordinator stopped duplicate work.

Private Xvfb/xdotool tools were downloaded and their virtual display was successfully probed at 1800×1100. **No native app lifecycle was exercised.** Rust tests, core Clippy, fresh desktop compilation, supplemental per-tab state assertions and actual native detach/dock/close remain for the successor run. No Linux native, macOS or Windows pass is claimed.

## Commands already executed

Heavy commands used `python3 scripts/guarded_run.py --` and ran one at a time; the guard forced one Cargo job and one Rust test thread. Logs and disposable profiles remain in ignored `.qa/` in the isolated worktree.

```sh
npm --prefix frontend run build
cargo build --locked -p chronoscope --bin chronoscope
npm --prefix frontend test
node frontend/scripts/detachable-tables-qa.mjs
node frontend/scripts/event-table-qa.mjs
node frontend/scripts/gis-files-qa.mjs
node frontend/scripts/si-rich-chat-qa.mjs
node scripts/generate_contracts.mjs --check
cargo fmt --all --check
python3 scripts/validation_suites.py
python3 -B scripts/test_guarded_run.py
python3 -B scripts/test_validation_runner.py
python3 -B scripts/test_glib_backport.py
python3 -B scripts/test_workarounds.py
python3 -B scripts/test_release_preflight.py
# Host-setup failure; not passed:
PKG_CONFIG_PATH=/workspace/scratch/tauri-sysroot/usr/lib/x86_64-linux-gnu/pkgconfig \
PKG_CONFIG_SYSROOT_DIR=/workspace/scratch/tauri-sysroot \
cargo clippy --locked -p chronoscope-desktop -- -D warnings
```

Machine-readable [receipt](result.json) and individual [tables](detachable-tables.json), [Events](event-table.json), [GIS](gis-files.json), and [SI](si-rich-chat.json) reports are retained without credentials. The reported SHA is the tested implementation; the receipt commit only adds this documentation.
