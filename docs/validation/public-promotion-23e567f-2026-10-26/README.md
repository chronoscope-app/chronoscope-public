# Next source promotion — 26 October 2026

Promotes the full tracked source of Next commit `23e567f5e1ae0c3f6ce993a5f0588b19713fbb70`, including the approved current demo/application updates and runner repair, onto Public parent `b41e8173b717382eb670d93d88deaa59171d7ca3`. All 3,109 Next tracked files match exactly. Eight Public-only historical promotion receipt files are retained; private Next ancestry is not imported.

The runner repair uses shell-free Windows npm entry-point resolution and retains source-check failure diagnostics. Local verification: 131 Python tests, 70 frontend tests, TypeScript/inventory/diff checks; independent full and exact-delta reviews found no blockers. Logical Windows tests are not native Windows acceptance. New Windows/macOS hosted runs will use the new Public SHA; their outcomes must be recorded separately, not inferred here.

Publication review checked tracked-file export safety, current source/archive scanning with a synthetic canary, source/asset hashes, new public-data attribution and app-only screenshots. The three scanner findings were recomputed SHA-256 checksum entries, not credentials; no scan rules were weakened. Fresh npm audit reports zero vulnerabilities; RustSec reports zero vulnerability entries plus six unmaintained, one Tokio I/O-unsoundness and one yanked clipboard-win warning. These existing unchanged-lockfile warnings remain visible and are not remediated or waived as native acceptance.

This is source promotion and CI verification, not a new release, release asset, version/tag change, signing/notarization claim or end-user platform acceptance. Existing 0.15.2 downloads remain unchanged; Unreleased notes identify current source differences.
