# Maintained workarounds

This is the index for shipped dependency patches and compatibility workarounds.
The [machine-readable register](workarounds.json) records the owner, source,
locked versions, regression checks, upstream reference and removal gate for each.
It links to the existing detailed records rather than replacing their hashes or
provenance. Source verification checks that those paths and version constraints
still match; a dependency update must review each affected entry.

| Workaround | Reason | Existing evidence |
| --- | --- | --- |
| Cesium terrain picking | Failed or obsolete worker tasks must not discard valid terrain triangles. | [Pinned patch](../../frontend/scripts/patches/terrain-picker.mjs), deterministic task-lifecycle regressions and multi-view terrain suite. |
| Cesium idle camera | Angle getters can introduce tiny orientation changes and keep an idle scene drawing. | [Mechanism, measurements and limits](../CESIUM-IDLE-RENDER.md). [PR #13982](https://github.com/CesiumGS/cesium/pull/13982) was open when checked on 25 October 2026. |
| Cesium Knockout/CSP | Find the global object without eval and retain the desktop CSP. | [Narrow Vite transform](../../frontend/vite.config.ts), CSP-enabled browser parity and native packaging/launch checks. |
| GLib variant iteration | Retain a reviewed security backport for the supported native dependency graph. | [Advisories, full file ledger and native test commands](../../vendor/glib/BACKPORT.md). |

For each dependency upgrade: inspect the upstream source, run the existing guard
and owning regression checks, and record whether the workaround remains required.
Remove one only after its removal gate passes with the workaround disabled.
An open or merged PR alone does not update the application's locked dependency.
Do not remove runtime assertions, widen tolerances, relax CSP, or suppress an
advisory to make the upgrade pass. Keep upstream notices and modified-source
records in exported source and distribution notices.

The separate [sparse point-upload PR #13948](https://github.com/CesiumGS/cesium/pull/13948)
was also open when checked. That upstream contribution is not a shipped patch
in the locked Cesium package. Its local research checkout and uncommitted work
are outside the product source and were preserved during workspace cleanup.

This index does not claim new native/GPU/security verification. Its automatic
checks establish inventory and version consistency; the linked runtime gates
still have to run on their stated platforms.
