# Release checklist

Use this for a future preview or production release. Documentation preparation does not authorize rebuilding/replacing historical assets, changing tags, purchasing signing services or making the repository public.

## Freeze the source

- Choose one clean, reviewed application commit. Record it in the release notes and build evidence. If platforms must use different source, label that explicitly instead of implying equivalent builds.
- Resolve the release's rights/source-access questions in [distribution](DISTRIBUTION.md) and [third-party exceptions](../THIRD_PARTY.md). Inventory the actual packaged components and notices; do not use the lockfile alone as a binary-compliance claim.
- Run locked dependency/security audits for the actual source and target. Review the maintained [GLib backport](../vendor/glib/BACKPORT.md) for Linux rather than dismissing a finding solely because the version number is unchanged.

## Build and verify locally

- Use the documented portable-build wrapper and locked dependencies. Keep GitHub workflows manual-only; do not dispatch hosted runners without explicit owner authorization.
- Record exact local commands, toolchains, target architectures and outcomes. Run the applicable source/browser suites and the final packaged executable's CLI/MCP checks.
- Test a fresh download/install/launch on each advertised native platform, with normal download quarantine/trust controls intact. Exercise open/save, demo loading, rendering, offline behavior and uninstall/removal. A local development launch, Wine console run or another OS is not a substitute.
- Distinguish minimum OS claims from the actual tested versions. Verify real GPU and physical certificate/card behavior before claiming them.
- For a broad macOS distribution, use the owner's Developer ID identity and notarization; verify the final downloaded artifact. Windows signing and native installation acceptance require their own review. Keep unverified builds clearly marked experimental.
- Inspect extracted final packages for notices, corresponding-source information, unintended home paths, private data and credentials. Verify that the bundled privacy/help documents match that executable.

## Publish only after owner approval

- Preserve older checksums and evidence. Do not silently replace an asset under an existing version or move a release tag.
- Produce SHA-256 checksums and a release-specific validation report. Test recipient access to any required source without private credentials before claiming it works publicly.
- Use **Pre-release** for experimental builds. Keep the release title, source SHA, platform, signing/trust status and unresolved limitations visible near the download links.
- Update [installation](INSTALLATION.md) and [changelog](../CHANGELOG.md) together. Never transfer test evidence from one binary to a newer build merely because its app version is the same.
- Recheck repository visibility and private-reporting availability separately. A release-label edit is not publication approval.
