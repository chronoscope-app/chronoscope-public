# Next 0.16.1: CLI and MCP altitude controls

Validated source: `45b48b8cc1e0cb86b4d9c51117796990f72c9c6b`. The [verification receipt](verification.json) records the installed bundle hash. The native title and bundle version read **0.16.1**, with Tauri core **2.12.5**. The signed local debug bundle was installed at `~/Applications/Chronoscope.app`; it is the only Chronoscope copy in that directory.

The [native check](native-report.json) used the **installed app's bundled executable** for both stdio MCP and attached CLI commands against a disposable native WKWebView profile. It loaded 88,018 samples from 100 flights and 2,456 samples from five rocket launches on Apple GPU / WebGL 2.0, with matching stem counts and no renderer errors. It exercised all three CLI height modes, retained Time Height scale through Altitude, rejected MCP reset with missing/false confirmation, and completed both MCP and CLI confirmed resets. Selection and camera survived both resets. Dataset heights remain explicitly approximate; [source and datum caveats](../../ALTITUDE-DEMOS.md) apply.

The [browser suite](browser-report.json) passed UI confirmation/default-Cancel checks and the actual reset adapter, including altitude coordinates, import mapping, save/reopen, segmented selection and disabled slider behavior. Four new adapter tests also cover confirmation, awaiting recovery, reported recovery failures and workspace changes. Rust tests cover discovery/schema/annotations, typed native responses without workspace-gate deadlock, CLI argument rejection, and actual altitude import, field profiling and role assignment.

Local checks passed: **106 unique Rust tests** (68 library and 38 focused integration checks), **150 frontend tests**, **20 validation-runner tests**, **5 version metadata tests**, generated-contract comparison, frontend/native builds and strict bundle signature validation. This run validates correctness, not an FPS improvement. GitHub workflows were not started, and no public promotion occurred. Windows/Linux native behavior was not checked.

## Reproduction

After building with `script/build_and_run.sh --verify` in a disposable profile:

```sh
python3 scripts/guarded_run.py -- python3 scripts/native_altitude_qa.py \
  --cli "$HOME/Applications/Chronoscope.app/Contents/MacOS/chronoscope-desktop" \
  --data-dir .qa/mac-altitude-native-profile --output .qa/mac-mcp-altitude-native
```

[CLI/MCP usage and confirmation contracts](../../CLI-MCP.md#globe-height-selection-and-altitude-0161). Reconnect existing MCP clients after updating the executable to refresh their cached tool lists.
