# 0.16.13 experimental preview publication — 2026-11-02

[Published release](https://github.com/chronoscope-app/chronoscope-public/releases/tag/v0.16.13). Both platforms were built from `ded19dbae0ce3a8c0edc4905aa51cec9b51ecdcf`. Exact application source, all 1,006 locked registry source archives, 1,581 selected notice files and checksums accompany the downloads. [Release manifest](RELEASE-MANIFEST.json) · [Source manifest](SOURCE-MANIFEST-RELEASE.json) · [Source parity](SOURCE-PARITY.json).

The local full source gate passed 522 Rust and 208 frontend tests, with two optional/ignored Rust checks and one frontend test skipped. Focused parallel core tests, hosted-context guard fixtures, archive validation, workflow lint and the exact Tauri command also passed. The full bundled-demo edit/save matrix also passed separately before publication. See [local verification](LOCAL-VERIFICATION.json). Both native build source gates passed; final native download receipts remain unchanged below.

| Platform | Build | Exact-package native validation | Package SHA-256 |
| --- | --- | --- | --- |
| windows-x86_64 | [run 41448105960](https://github.com/chronoscope-app/chronoscope-public/actions/runs/41448105960) | [run 41453042951](https://github.com/chronoscope-app/chronoscope-public/actions/runs/41453042951) | `73199ca248db74fcff2c424dbd390a4be4ed3b35aaba0afab8fcfd43305bb3e2` |
| macos-arm64 | [run 41453441984](https://github.com/chronoscope-app/chronoscope-public/actions/runs/41453441984) | [run 41460067265](https://github.com/chronoscope-app/chronoscope-public/actions/runs/41460067265) | `b1bc59b2abdc5970f2b58b3cfb5c41d159bd26cda4687e8354c79ff2e61b6abe` |

[Windows native receipt](HOSTED-VALIDATION-windows-x86_64.json) · [Mac native receipt](HOSTED-VALIDATION-macos-arm64.json) · [Anonymous downloads](anonymous-downloads.json) · [Security review](SECURITY-REVIEW.json) · [Verification reuse fixture](VERIFICATION-REUSE-CHECK.json).

Builds used standard hosted platforms one at a time, manual-only workflows and existing zero-dollar hard-stop budgets. Bounded dependency cache payloads retain at most 2 GiB. Source checks and builds share portable compiler flags; the frontend builds once and its complete hashes are checked before packaging. Exact-source/platform/toolchain verification reuse was exercised against the real artifact in an isolated local coordinator fixture; that fixture is not native Windows acceptance. Native package acceptance is recorded separately above. Thin LTO and one release codegen unit are unchanged.

Runner validation repaired stale demo/sample-preview expectations, isolated hosted guard fixtures, removed a disk-speed-dependent concurrency timeout, checked original ZIP headers on Windows and corrected Tauri/Cargo argument ordering. These changes preserve app cancellation deadlines and release optimization.

Windows is unsigned and requires WebView2. Mac is ad hoc signed, not notarized. Native automated checks cover actual extracted desktop CLI/agent/MCP behavior, GUI launch and an attached engine query; Mac also verifies the strict bundle seal, App Intents metadata and weak frameworks. Manual installer, normal quarantined-download, physical GPU/card and broad production acceptance are not claimed. No Linux or Intel Mac binary is advertised. Historical releases/tags/assets are preserved.
