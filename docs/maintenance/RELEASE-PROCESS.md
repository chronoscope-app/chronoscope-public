# Preparing and promoting a preview

Source promotion, platform builds and publishing downloads are separate steps.
Development stays in Next. Public promotion and hosted runs require the owner's
explicit authorization. Keep workflows manual-only and preserve existing tags,
checksums, notes and downloads.

1. **Prepare Next.** Check pending Next branches for completed work, integrate
   intended changes into main, and run applicable local verification. Keep one
   heavy guarded run active. Record failures and platform limitations, including
   UI/GPU checks that cannot run while the screen is locked.
2. **Choose a new download version.** Run
   `python3 scripts/release_preflight.py --plan-version 0.15.3` using the intended
   version. The plan makes no edits. Update the five manifests and corresponding
   application entries in Cargo.lock/frontend/package-lock.json together. Preserve
   unrelated locked dependency versions. Move the intended Unreleased summary into
   a dated version section, leave Unreleased empty, and retain historical notes.
   Run the normal metadata preflight and local checks again. Do not label a newer
   build as an unchanged older download.
3. **Prepare the Public promotion for review.** Start from current Public main,
   copy the reviewed Next tracked source, and preserve Public-only promotion
   receipts. Verify every Next source file is byte-identical in the candidate;
   inspect any Public-only files separately. Preserve Public's independent parent
   history rather than importing private Next ancestry. Use the existing tracked
   source-export boundary, secret review and publication checklist. Record both
   Next and Public candidate SHAs. The owner approves this concrete candidate
   before Public is updated.
4. **Freeze the exact Public source.** In its clean checkout, fetch the current
   Public tags (an isolated checkout is preferred; the preflight also recognizes
   tags fetched under `refs/tags/public/`). Run
   `python3 scripts/release_preflight.py --for-release --expected-sha FULL_PUBLIC_SHA`.
   The preflight reads local refs only; stale/unfetched tags are not clearance.
   Public and Next commit IDs differ even when application files match.
5. **Build and validate that source.** When authorized, dispatch one configured
   standard hosted platform at a time with `expected_sha` equal to the frozen
   Public SHA, after the existing budget/storage check. Do not rebuild under an
   old tag or substitute a later main commit silently. The shared source gate
   retains the same local checks; generated contracts are checked using the actual
   built release CLI. Keep each platform's run ID, source SHA and package hash.
6. **Validate the actual downloads.** Use the exact-package validation workflow
   with its reviewed validator SHA and independently checked package checksum.
   Prepare matching application/dependency source companions, notices, checksums
   and manifests as required by [distribution](../DISTRIBUTION.md). Preserve
   signing, platform and native acceptance limits in the notes; an automated
   package check alone does not establish full user-device acceptance.
7. **Publish a new experimental release after approval.** Attach the matched
   packages and companions to a new version tag, with concise user-facing changes,
   known limitations and source/build identification. Update installation/download
   links and the changelog together. Verify recipient access and downloaded hashes.
   Never overwrite existing assets or move an existing version tag.

The preflight and plan are read-only. They do not build, push, promote, dispatch,
create tags, upload assets or authorize publication. Development source may keep
an Unreleased list and the prior app version until a new preview is deliberately
prepared; the stricter `--for-release` mode is for the frozen release candidate.

## Shared source-check launch and diagnostic contract

Maintain `scripts/source_checks.py`, `scripts/validation_runtime.py` and
`.github/workflows/build.yml` in Next and export them together. The workflow
intentionally runs only from Public main; this guard is not workflow drift or
permission to repair only Public's exported copy. Keep promotion receipts and
independent Public history as described above.

Source checks, the resource guard and portable builds share the child's
PATH/PATHEXT resolution. Native executables keep literal argv. Standard Windows
npm.cmd/npm.bat layouts launch sibling node.exe with
node_modules/npm/bin/npm-cli.js directly, without cmd.exe or shell expansion.
Arguments including spaces, quotes and metacharacters stay separate argv tokens;
POSIX argv is unchanged. Missing/incomplete installations and non-npm batch
wrappers fail closed instead of falling back to a shell or another installation.
This supports the standard Node distribution layout, not arbitrary custom npm
wrappers or their alternate global-prefix/runtime selection behavior.

Every completed check, including a failing launch, retains the current report,
per-run receipt and combined stdout/stderr log. Console failure summaries expose
only a sanitized launch category/error number or exit/timeout status and the
evidence paths, not arbitrary log tails or environment dumps. The pinned
`if: always()` upload retains only these source/contract reports and suite logs
for one day, not the whole runner temp/workspace. Inspect retained logs before
sharing beyond the build's normal access boundary.

Logical Windows-path and mocked Popen tests are not native Windows acceptance.
After promotion and explicit hosted-run authorization, freeze the resulting
Public SHA and test Windows before claiming this platform fixed.
