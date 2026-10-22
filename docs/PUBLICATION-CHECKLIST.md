# Owner review before publication

This checklist covers the new standalone `chronoscope-app/chronoscope-public` source snapshot only. Keep the original development repository private. Earlier history/tags/releases are excluded, not migrated. Only the owner-authorized new repository may be published; organization-profile and binary releases remain separate decisions.

Current evidence and limitations: [publication status](PUBLICATION-STATUS.md). Future executable releases have their own [release checklist](RELEASE-CHECKLIST.md).

## Before changing visibility

- [x] Complete the initial authenticated local full-history and working-tree secret scans; see [results and scope](SECURITY-CHECKS.md). Re-run against the exact final launch refs after further changes.
- [ ] Freeze and review the final application commit and every exposed branch/tag, including human review of logs, screenshots, embedded projects and binary metadata. Automated scanning alone is incomplete. Rotate any discovered real credential before considering removal; do not rewrite history silently.
- [x] Replace the uncertain/noncommercial media at HEAD: public-domain Natural Earth shaded relief, original synthetic DTED/imagery fixtures, fresh credited native screenshots; retire obsolete compositions, copied GSAP and unproven audio. [Source/rights index](../THIRD_PARTY.md) · [media ledger](MEDIA-RIGHTS.json).
- [ ] Verify the new repository contains one fresh unparented commit, only main, no tags/releases/PR history, and no alternates or imported historical objects. Historical media-ledger records are metadata, not imported payloads. Verify exact future binary dependency/source-access obligations in [distribution](DISTRIBUTION.md).
- [x] Owner selected GitHub private vulnerability reporting at publication. It remains unavailable while private. Update [SECURITY.md](../SECURITY.md) when the route actually works.
- [ ] Review organization owners/recovery, two-factor authentication, collaborators, Apps/OAuth access, inherited secrets/hooks/runners and Actions settings. Keep permissions minimal, workflow tokens read-only, fork approvals appropriate and workflows manual-only. Uninspected or permission-blocked settings are unknown, not empty.
- [x] Run initial locked Rust and JavaScript dependency/security audits and apply the reviewed security updates. Six Rust maintenance warnings remain documented in [security checks](SECURITY-CHECKS.md). Re-audit the exact launch source/target graphs, including the Linux GLib backport.
- [ ] Decide the launch scope: experimental public source or a broader downloadable-app launch. Signing/notarization and native fresh-download acceptance remain necessary before stronger installation/support claims. No binaries are included or advertised in this clean repository.

## At the owner-authorized publication step

- [ ] Change visibility only on explicit owner instruction, then verify signed-out repository/download access. Verify GitHub-generated source archives match this clean snapshot, and that no old refs, release attachments or Actions history/logs were imported.
- [ ] Enable and verify private vulnerability reporting; update its policy. Enable available secret scanning, push protection and dependency alerts. Check any billing/permission requirement before accepting it. Preserve manual-only workflow triggers.
- [ ] Apply available public-repository main protection/rulesets: block force pushes/deletion and require pull requests, with a documented owner recovery path. Require approving reviews only when another eligible maintainer can provide them. Do not require CI checks that never run. Private-Free availability may require waiting until publication; do not upgrade a plan automatically.
- [ ] Test issue forms, security intake, README images, redirects, source links, download checksums and platform labels as an ordinary visitor. Authenticated maintainer access does not prove public access.
- [ ] Apply the prepared [organization introduction](ORGANIZATION-PROFILE.md), icon and repository pin if separately authorized. A new public `.github` profile repository needs its own owner decision while publication is pending. Add a website/contact only when provided and verified.

## Owner input still needed

GitHub private reporting at launch is selected, and the initial full-history scan is complete. Review the exact one-commit snapshot and verify historical refs/releases are excluded, confirm GitHub 2FA/recovery, establish signing-account access before future downloads, and authorize public organization-profile publication separately. Do not paste credentials or signing keys into an issue or this checklist. No history rewrite, purchase or new access grant is implied.
