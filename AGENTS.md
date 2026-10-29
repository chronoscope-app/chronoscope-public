# Repository instructions

- Run verification locally. Do not dispatch or rerun GitHub Actions workflows or start GitHub-hosted runners unless the user explicitly requests it.
- Keep GitHub Actions workflows manual-only so normal pushes and pull requests do not consume the user's runner allowance.

- Develop and validate updates in chronoscope-app/chronoscope-next. Do not push or publish changes to chronoscope-app/chronoscope-public until the user explicitly authorizes promotion.

- Completed work intended for Next must be integrated into `chronoscope-next/main`, not left only on a feature branch. Before building the latest version, check pending Next branches so recent completed work is not omitted.

- After every successful macOS app build, copy the finished bundle to `~/Applications/Chronoscope.app` and keep only the latest Chronoscope app in that directory. The user explicitly authorizes replacing or deleting older Chronoscope app copies there. `script/build_and_run.sh` does this automatically; for other build commands, run `python3 scripts/install_macos_app.py /path/to/Chronoscope.app` afterward.

- Finish user-facing Mac builds with `script/build_and_run.sh --build-only`, which creates an optimized release copy. `--debug-build-only` and interactive diagnostic modes create slower debug copies; rebuild the optimized copy after those checks.

- Keep the bundled Starlink workspace, its previews and associated credit metadata together at or below 5,000,000 bytes. Full Starlink source/stress data must remain ignored local fixtures, outside app resources.
