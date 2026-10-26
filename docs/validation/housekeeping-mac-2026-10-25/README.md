# Incremental housekeeping — Mac verification

All eight requested areas were addressed in separately checked checkpoints on
Next main. The final application/tooling source is `67b24fc`; this receipt is a
documentation-only follow-up. No Public promotion, hosted dispatch, version bump,
release tag or download publication was performed during this housekeeping task.

| Area | Completed change |
| --- | --- |
| Resource protection | Normal build/validation entry points automatically share a workspace lock and guard. Nested hooks reuse readable ownership metadata, including on Windows. Mac work runs at low priority with one Cargo worker, serial tests, pressure/disk checks and a scoped idle-sleep assertion. Old completed disposable test profiles have a preview-first retention tool; native profiles and evidence are retained. |
| Shared definitions | Preferences, filters, scene/saved-view/group state and camera types come from generated engine contracts instead of parallel frontend definitions. |
| Interface structure | Preferences form/draft/setup flow and modal keyboard-focus ownership moved into separate controllers. A delayed-status regression preserves reading the latest settings after asynchronous work. |
| Map boundaries | Camera capture/restore, scene colors and preference/resource-change decisions are separate modules. Object-key order does not trigger resource replacement; meaningful layer order does. Camera/provider preservation and actual view navigation remain checked. |
| Errors | Schema validation and saved navigation recipes choose explicit typed categories. Older String/native/persistence boundaries retain compatibility adapters; this is an incremental migration. |
| Verification | Local and manual hosted source checks use one shared plan/inventory. Generated contracts are checked against the built CLI. Actual About/guide dialogs replace version-source-string assertions. |
| Workarounds | A version-checked ownership/removal index links the existing terrain, camera, CSP and GLib fixes to their regressions and upstream records. No workaround was removed. |
| Release preparation | Read-only version/lockfile/changelog checks, a proposed-version plan, frozen-source/tag checks and a reviewed promotion/release procedure. The build remapper accepts the known jobs-only config while retaining checks against overridden compiler flags. |

The Public build follow-up's Windows short/long-path assertion now checks actual
filesystem identity. The portable-workspace scene fixture explicitly saves Fade
off and verifies it survives named-view/portable round trips. Local packaging,
import/workspace and playback checks pass; the failed hosted builds were not rerun.

## Verification

The [machine-readable report](report.json) records checkpoints, exact source,
checks and limits. Raw logs/run receipts remain in ignored local QA storage.

- Complete core Rust gate: **415 passed**, one intentional full-data matrix
  ignored. Rust product source did not change after that gate.
- Final clean-source local runner: **22 stages passed**, including source/integrity
  checks, fresh CLI/frontend builds, generated contracts and **70 frontend tests**.
- Four final browser suites passed serially: integration smoke, bundled terrain,
  view sync and navigation/preferences. Earlier controller checks also passed
  toolbar/dialog layout, welcome/focus and presentation/version-dialog suites.
- **104 packaging regressions** passed across publication, distribution, tester
  packaging and exact-download validator tests.
- Strict native Clippy, desktop compilation and the actual desktop executable's
  headless CLI/agent/MCP smoke passed. No native GUI window was launched.
- Final guarded run peaked at **2,194 MiB owned RSS** and a brief **308% tree CPU**
  sample. The guard retains its sustained 250%/15-second CPU limit, 5 GiB RSS and
  memory-pressure thresholds. Browser jobs, Cargo workers and test concurrency
  stayed at one. These are owned-process measurements, not GPU memory/timing.

The final command used the configured local SDK/Node/Python environment:

```sh
python3 scripts/validate_local.py --suite integration-smoke --suite navigation-preferences --suite view-sync --suite balanced-terrain --packaging --native --report .qa/housekeeping-final/report.json
```

The Git CLI could not publish a workflow edit with its existing OAuth scopes.
The authorized connected GitHub account published that checkpoint with a file
tree verified identical to the locally tested tree. Only unpublished follow-ups
were synced onto it; content was unchanged and published history was not rewritten.
A later transient network timeout was retried successfully.

Native GUI/video, Windows/Linux device acceptance, optional full-data/hardware
benchmarks, certificate hardware, paid/local model quality and actual downloaded
installer acceptance were not run. Headless browser and native CLI results do
not certify those checks. The large-file and error refactors retain compatibility
boundaries; this is not a claim that every architectural debt has been eliminated.
