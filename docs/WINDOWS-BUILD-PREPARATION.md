# Windows build preparation

Run locally in PowerShell 7 with its existing execution policy. This prepares
installed tools and a persistent process environment; it does not build, publish,
delete caches, alter source, change user/machine PATH, or reduce release gates.

```powershell
& ./scripts/prepare_windows_build.ps1
. "$env:LOCALAPPDATA/ChronoscopeBuild/environment.ps1"
```

The script requires installed Rust 1.98.0 with rustfmt, Clippy and LLVM tools;
Node 22; Python 3.13; MSVC x64 tools; WebView2 Evergreen; Tauri's cached NSIS;
and 7zip. Explicit `-NodePath`, `-PythonPath`, and `-SevenZipPath` override
discovery. Missing tools fail preparation with a JSON receipt rather than being
silently downloaded. Install missing prerequisites through their supported
installers, then rerun. Receipts are uniquely timestamped under
`%LOCALAPPDATA%/ChronoscopeBuild/receipts`; `-Report` selects another local path.

Cargo registry, npm cache and target paths persist independently of the source
checkout. `-TargetDirectory` adopts an existing warm target without moving or
deleting it. Otherwise the target namespace is
`ChronoscopeBuild/target/windows-x86_64/rust-1.98.0`. The generated environment
retains an existing Cargo home/npm cache and uses two Cargo workers and four test
threads by default; both are explicit parameters. No `RUSTFLAGS`, release LTO or
codegen setting is changed. Use the shared portable build wrapper/pipeline for
the actual build; coordinator-owned source/flag verification remains required.

## Symlink capability

Preflight creates and removes real file and directory symlinks in its private
probe directory and verifies that targets survive cleanup. Missing privilege is
a failure. The original rejection tests are not skipped or modified.

If the real probe fails with WinError 1314, an administrator can explicitly run:

```powershell
& ./scripts/prepare_windows_build.ps1 -EnableDeveloperMode
```

This opt-in operation sets only Microsoft's documented
`HKLM/SOFTWARE/Microsoft/Windows/CurrentVersion/AppModelUnlock/AllowDevelopmentWithoutDevLicense`
DWORD to 1. It requires an already approved administrator session; the script
does not elevate itself or change execution policy. It enables no Device Portal,
device discovery, SSH, antivirus exclusions or other permissions. Record the
prior DWORD from the receipt if the machine owner later chooses to undo it.
Then rerun preflight in the ordinary build session and rerun the original failing
tests. See [Microsoft's Developer Mode documentation](https://learn.microsoft.com/windows/apps/get-started/developer-mode-features-and-debugging)
and [CreateSymbolicLink's unprivileged flag](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-createsymboliclinka).

## Representative test profiling

`benchmark_windows_tests.py` compares explicitly selected existing native test
binaries at 2/4/8 threads in forward/reverse order. Use a monitoring Python with
`psutil` installed. It preserves `guarded_run.py`, records hashes, unchanged test
counts, libtest versus outer wall time, process-tree peak RSS and minimum system
headroom. It stops only its owned process tree below 3 GiB free or on timeout.
It does not compile binaries or change fixtures. Select binaries from an exact
source build and retain their source SHA in the report. Results are warm-cache
representative measurements, not a full-suite or cold-build speed claim.

Focused tooling tests: `python -B scripts/test_windows_build_preparation.py`.
