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
