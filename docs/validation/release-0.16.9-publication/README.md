# 0.16.9 experimental preview publication — 2026-10-29

[Published release](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.9). Windows source `19b4587994bb08083d4693e10e0df2d2f0bfc3f4`; macOS source `c5c532749397edbfc8b023fd1171fa0ac2a46d14`. [Application source parity](application-source-parity.json) proves that only the notice validator and its tests differ. Both exact source archives are attached; all 982 locked registry archives were independently hash-verified. Notice payloads retain 1,536 source-matched files. [Source access manifest](SOURCE-MANIFEST-RELEASE.json).

The full local gate passed 482 Rust tests (one existing optional matrix ignored), 161 frontend tests, formatting, Clippy, generated contracts and packaging checks. Dependency audits returned zero vulnerabilities, with six existing unmaintained and one yanked advisory warning retained. The first exact Windows validation stopped before runtime at a stale 1,531-file count; [the repair](validator-repair.json) pins 1,536 and adds a regression against the actual selected source inventory. Its 39 validator and 23 distribution tests passed locally. The existing Windows app package was retained unchanged and successfully revalidated.

| Platform | Build | Exact-package native validation | Package SHA-256 |
| --- | --- | --- | --- |
| Windows x64 | [run 40895638945](https://github.com/chronoscope-app/chronoscope-public/actions/runs/40895638945) | [run 40910679424](https://github.com/chronoscope-app/chronoscope-public/actions/runs/40910679424) | `103d5484b84ec4ac006a29dc10bb053c168a54de6728bebc309a37c6b94d6ede` |
| macOS ARM64 | [run 40913190241](https://github.com/chronoscope-app/chronoscope-public/actions/runs/40913190241) | [run 40921037437](https://github.com/chronoscope-app/chronoscope-public/actions/runs/40921037437) | `c08573db36b21d0f4ed46c2f888157e793912345c5f91b2a1b979a2e6e9d06a2` |

[Release manifest](RELEASE-MANIFEST.json) · [Windows receipt](HOSTED-VALIDATION-windows-x86_64.json) · [Mac receipt](HOSTED-VALIDATION-macos-arm64.json) · [Anonymous downloads](anonymous-downloads.json) · [Installed exact Mac release](installed-mac-release.json) · [Historical releases preserved](historical-releases-preserved.json).

Native checks cover actual extracted GUI executable CLI/agent/MCP behavior, GUI launch and an attached engine query. Windows is unsigned; Mac is ad hoc signed, not notarized. These checks do not establish visual interaction, physical GPU/card, manual installer or normal quarantined-download acceptance. Local Mac flight canvas capture was unavailable while locked; rendered saved scenes and cross-day playback passed headless Chrome. No Linux or Intel Mac binary is advertised.

Builds ran one standard public hosted platform at a time with existing zero-dollar hard-stop budgets and no caches. Only this task's temporary Windows package artifact was removed after successful exact native checks and server-verified draft backup, keeping Actions storage bounded. Old release assets and tags are unchanged. Workflows remain manual-only. Separate clawcomp Terra experiments were not integrated into this release.

The post-publication scan of new receipts produced one generic-key match on the public Windows Git commit ID in `SOURCE-MANIFEST-RELEASE.json`. Its Git object type was verified; [review](receipt-secret-scan-review.json). No scanner rule was relaxed and no unreviewed finding remains.
