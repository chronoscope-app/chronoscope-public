# Releases on the three development computers

Use the same clean, frozen Public source commit on each native computer. Keep a
stable release checkout and its ignored `target`, Cargo and npm caches between
releases. Changing checkout paths, compiler/SDK versions or portable flags can
invalidate compiled objects. Do not copy a build from one platform to another.

The prepared environments use Rust 1.98.0, Node 22.23.4 and Python 3.13.18.
The installed platform SDK remains part of every verification receipt. Release
optimization remains Thin LTO and one code-generation unit. Keep the personal
Mac resource guard; benchmark other hosts' worker limits against actual memory
headroom rather than increasing them blindly.

## Prepare once, check before every release

On Apple Silicon macOS, source the existing local Rust bootstrap environment,
then run `python3 scripts/prepare_macos_build.py`. Source the generated ignored
`environment.sh`. The preparation installs tools locally, verifies the uv wheel
and Node archive checksums, and leaves the system Python/Node configuration alone.
Pass `--directory` to reuse an existing prepared tool directory from a stable
release checkout.

Windows and Linux use their respective `prepare_windows_build.ps1` and
`prepare_linux_build.py` environment preparation. Retain their generated
environment and native capability receipts. Windows requires real file and
directory symlink privileges for rejection tests; approve any required Windows
administrator-consent prompt yourself. Do not replace those tests with skips.
Linux requires matching GTK/WebKit headers, runtime and the documented native
source/replacement gate before publishing its AppImage.

## Build or resume locally

From that prepared environment in the frozen checkout:

```sh
python scripts/local_release.py --target macos-arm64 \
  --expected-sha FULL_PUBLIC_COMMIT --output /outside-checkout/release/macos
```

Other targets are `windows-x86_64` and `linux-x86_64`. Use native path syntax on
Windows. `--preflight-only` checks tool versions, architecture, native tooling,
free disk and symlink capabilities before compilation. `--verify-only` prepares
the verified source/frontend without creating a distribution. `--evidence`
selects the ignored receipt directory; keep it between retries.

The command runs all source and packaging checks, desktop lint, locked optimized
CLI/GUI builds, generated-contract checks and actual-package validation. The
frontend builds once, is sealed to the source/toolchain identity, and is checked
again by the GUI packaging hook. Mac builds finish through
`script/build_and_run.sh --build-only`, which installs the latest app locally.
Old installer versions are preserved outside the bundle directory so they cannot
silently confuse actual-package validation.

Resume records require identical source, tools, compiler/configuration/native
flags and unchanged recorded outputs. Changes invalidate the applicable cached
work. Failed checks never become successful receipts. Cargo still validates its
own release artifacts; the CLI and its generated contracts are checked on every
invocation. Exact verified GUI and package outputs can be reused for packaging
retries. Modified or unknown output directories are preserved or refused rather
than silently overwritten. Local receipts are not signatures or remote trust
proofs.

Every run records phase durations, reuse, cache size, logs and artifact hashes.
Record both first-build and warm-retry timings. Separate setup, tests, compilation
and packaging when comparing computers. The hosted dependency cache remains
bounded to 2 GiB; it now selects complete crate groups rather than discarding all
compiled work when the entire target directory exceeds that cap.

## Coordinate and publish

Start native builds concurrently on Mac, Claw and Win after all three preflights
pass and the same source commit is frozen. These local commands never push,
publish, upload or dispatch GitHub workflows. Workflows remain manual-only.

Before an authorized publication, retain the matching application/dependency
sources, actual-package and native receipts, notices, hashes and reviewed release
notes. Linux additionally needs its exact native-library sources and replacement
record. Validate the actual downloads and preserve signing, platform and manual
acceptance limits. Follow [the release procedure](maintenance/RELEASE-PROCESS.md)
and [distribution gates](DISTRIBUTION.md); never replace historical assets or tags.
