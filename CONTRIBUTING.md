# Contributing

Discuss substantial changes in an issue first. Keep patches focused; include regression coverage and exact local commands/results. Use synthetic data, portable paths and GitHub noreply commit attribution if you do not want a public email in Git history. Never commit credentials, private logs or unrelated host/window receipts. Review staged diffs and mixed-license notices before submission. Contributions must be yours to share; identify third-party sources, terms and modifications rather than labelling everything MIT. See [THIRD_PARTY.md](THIRD_PARTY.md).

Start with `python3 scripts/validate_local.py --list`; inspect suite commands before running. The normal gate is `python3 scripts/validate_local.py`; `--browser` adds the short smoke path, `--feature maps` or `--suite navigation` selects focused coverage, and `--tier full` retains every registered browser regression and the complete demo matrices. See [test tiers, prerequisites and ownership](docs/TESTING.md). Performance/hardware/provider tests are opt-in. Report missing prerequisites and unrun tests honestly; Linux tests do not prove Windows/macOS compatibility.

Before publication or a dependency/security change, follow [local security checks](docs/SECURITY-CHECKS.md). Keep scan reports redacted and outside the repository. Do not add broad allowlists or dismiss findings merely to obtain a passing result.

GitHub workflows must remain **manual-only** per [repository instructions](AGENTS.md). Do not dispatch hosted runners without explicit owner authorization. Review Action pin updates against upstream immutable commits. Do not add permissions, credentials or automatic CI triggers incidentally.

Use the pull-request template to record the problem, resulting behavior and exact local checks. There is no automatic hosted CI gate; missing platform evidence must be called out, not inferred from another OS. The maintainer remains responsible for reviewing and merging changes.

Release changes require exact-source provenance, checksum verification, package notices/source-access review and native platform evidence. Follow the [release checklist](docs/RELEASE-CHECKLIST.md). Use the portable build wrapper and inspect final strings; do not replace published assets or rewrite history without separate owner approval.
