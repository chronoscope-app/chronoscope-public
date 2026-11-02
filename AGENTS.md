# Repository instructions

- Run verification locally. Do not dispatch or rerun GitHub Actions workflows or start GitHub-hosted runners unless the user explicitly requests it.
- Keep GitHub Actions workflows manual-only so normal pushes and pull requests do not consume the user's runner allowance.

- Develop and validate updates in chronoscope-app/chronoscope-next. Do not push or publish changes to chronoscope-app/chronoscope-public until the user explicitly authorizes promotion.

- Completed work intended for Next must be integrated into `chronoscope-next/main`, not left only on a feature branch. Before building the latest version, check pending Next branches so recent completed work is not omitted.

- After every successful macOS app build, copy the finished bundle to `~/Applications/Chronoscope.app` and keep only the latest Chronoscope app in that directory. The user explicitly authorizes replacing or deleting older Chronoscope app copies there. `script/build_and_run.sh` does this automatically; for other build commands, run `python3 scripts/install_macos_app.py /path/to/Chronoscope.app` afterward.

- Finish user-facing Mac builds with `script/build_and_run.sh --build-only`, which creates an optimized release copy. `--debug-build-only` and interactive diagnostic modes create slower debug copies; rebuild the optimized copy after those checks.

- Keep the bundled Starlink workspace, its previews and associated credit metadata together at or below 5,000,000 bytes. Full Starlink source/stress data must remain ignored local fixtures, outside app resources.

- Keep terrain packs, optional demo source tables, and routine validation captures out of Git. Use `assets/data-assets.json` and `scripts/fetch_data_assets.py`; preserve compact offline demos and credit metadata. Keep local evidence ignored and publish deliberately selected evidence as release assets. Run `python3 scripts/check_repository_assets.py` before committing.

## Verification scope

- Use `python3 scripts/validate_local.py` for routine unit/type checks, plus a relevant focused regression when behavior changes. This quick pass does not validate Rust or packaging.
- For Rust/data changes, select the owning `--feature` or `--rust-test`. Use full, packaging, security, performance and platform checks when the change or release requires them. Release acceptance retains its existing gates.
- Run checks once against final code; repeat affected checks after changes or failures. Finish app changes with one optimized Mac build after validation. Test, documentation and tooling-only edits do not require an app rebuild.
