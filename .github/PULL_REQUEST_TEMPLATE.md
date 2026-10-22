## Change

Describe the problem and resulting behavior. Link an existing issue if relevant.

## Local verification

List the exact commands run, their results and any checks not run. For UI changes, include safely redacted before/after screenshots. Name the tested OS/architecture; do not infer native compatibility from another platform or Wine.

GitHub Actions remains manual-only. Do not dispatch workflows or add automatic triggers without explicit owner authorization. Do not attach credentials, private workspace data or unreviewed logs.

## Review

- [ ] The change is focused, and new behavior/limitations are documented where needed.
- [ ] Local checks appropriate to the change are recorded above.
- [ ] Shared fixtures and screenshots contain synthetic or appropriately licensed public data, with required credits.
- [ ] No secrets, private records or unintended machine/account information are included.
- [ ] Dependency, permission, network and release changes are called out explicitly, if applicable.

Release-only changes must also satisfy [the release checklist](../docs/RELEASE-CHECKLIST.md). See [contributing](../CONTRIBUTING.md) and [third-party exceptions](../THIRD_PARTY.md).
