# Linux native build and source preparation

These tools prepare evidence for a reviewed release; they do **not** clear a
Linux binary for publication. The exact final AppImage, source commit and
compiler environment must be frozen first. The native-source and replacement
gate in `docs/DISTRIBUTION.md` remains in force.

## Prepare a persistent build environment

On Ubuntu x86-64, install or provide an isolated Python 3.13, Node 22/npm, Rust
and Cargo 1.98.0, GTK/WebKitGTK development SDK and matching system runtimes.
The script writes only to its marked state directory and a `target` symlink in
this checkout. Give it a **stable, dedicated** state path outside the checkout;
do not point it at an unrelated cache or existing target directory:

```sh
python3 scripts/prepare_linux_build.py \
  --sdk /absolute/path/to/relocated-sdk \
  --state /absolute/path/to/dedicated-linux-release-state \
  --python /absolute/path/to/python3.13 \
  --node /absolute/path/to/node22 \
  --npm /absolute/path/to/npm
source /absolute/path/to/dedicated-linux-release-state/environment.sh
```

The preflight checks GTK, WebKitGTK and JavaScriptCoreGTK SDK versions against
installed distro versions, WebKit helpers, copyright records and toolchains.
A mismatch fails. `--allow-sdk-runtime-version-skew` records an explicit
acknowledgment for investigation; it does not establish ABI compatibility or
release approval. Check the resulting `preflight.json` and
`preflight-attempts.jsonl`. It installs a local `pkgconf` wrapper that translates
relocated SDK **variable output** to the matching `/usr` runtime path for the
GTK packaging plugin; it does not alter compiler flags or system pkg-config.
The exported empty `CARGO_ENCODED_RUSTFLAGS` is used only when no existing
flags were supplied, allowing `build_portable.py` to append its reviewed path
mappings. Existing explicit flags remain the caller's responsibility.

The selected worker count accounts for available RAM and CPU affinity. To run a
command with the memory watchdog, append `--run command ...` to the prepare
invocation. It records one-second memory samples and terminates only its own
process group below 2.5 GiB host-available RAM. When sourcing the environment
and invoking the shared release pipeline separately, that pipeline must supply
its own pressure guard. This tool does not alter release LTO or codegen units.

## Inventory and retrieve distro source

Use the final AppImage and independently obtained expected SHA-256. Inventory
performs a bounded `unsquashfs` extraction without executing the AppImage. It
hashes every extracted file, records symlinks, and identifies ELF files/fonts.
The output directory must not exist:

```sh
python scripts/package_linux_sources.py inventory \
  --appimage /absolute/path/to/Chronoscope.AppImage \
  --sha256 EXPECTED_FINAL_APPIMAGE_SHA256 \
  --output /absolute/path/to/new-inventory
```

Exact matches compare file bytes with installed distro packages. ELF build-ID
and `.text` matches are **provisional leads**, not proof that all other bytes or
packaging revisions match. Modified ELF files, launcher/runtime binaries,
application-owned files, fonts, other resources and unowned files still need
individual provenance and license review. An installed package database is
not a signed build attestation.

For source retrieval, create a private deb822 `.sources` file with `Types:
deb-src`, HTTPS Ubuntu archive URIs, matching suites/components, and an explicit
`Signed-By` keyring. The script updates only its own apt index, downloads exact
source revisions, verifies authenticated index hashes and `.dsc` SHA-256 entries,
records version-specific URLs and hashes, and retains distro copyright records
when safely identifiable. It never modifies `/etc/apt` or installs packages:

```sh
python scripts/package_linux_sources.py collect \
  --inventory /absolute/path/to/new-inventory/inventory.json \
  --sources-file /absolute/path/to/reviewed-ubuntu-sources.sources \
  --output /absolute/path/to/new-source-collection \
  --include-candidate-sources
```

Omit the final option to collect only exact-byte matches. A candidate source
archive is not verified correspondence until its binary provenance is reviewed.
Review failed downloads, missing notices and `unresolved` entries. Apt output
and per-package logs are retained. The collected source, source URLs and
copyright records do not choose a license alternative or replace the required
release-specific legal/source-access review.

For a reviewed package, a recipient can retrieve the **recorded exact version**
from the recorded signed distro source repository with `apt-get source
--only-source PACKAGE=VERSION`, install that package's documented build
dependencies in a suitable isolated environment, and follow its `debian/rules`
(e.g. `dpkg-buildpackage -b -uc -us`). This is a starting point, not an
assertion that a rebuild was performed or that its output matches the binary.
Retain exact originals, distro patches, notices and build requirements as the
release review directs.

## Narrow replacement probe

`check_linux_replacement.py --inventory INVENTORY --output NEW_DIRECTORY`
checks the AppImage hash and extracted tree, copies the AppDir, adds a marker
section to a WebKit library in that copy, and executes the copied AppDir's
`AppRun --help` with dynamic-loader tracing and isolated app data. It verifies
the altered library was loaded. **This executes the app's launcher**: use only
a trusted, reviewed artifact. It does not rebuild source, test GUI behavior,
prove all replacement/relinking obligations, or grant release clearance.

Run focused tests locally with `python -B scripts/test_linux_release_tools.py`.
The coordinator owns registration in the shared validation suite. Inventory,
collection and probe outputs always set `release_clearance: false`; only an
independent final-artifact review can resolve the outstanding gate.

## Reproduce native ELF transformations

After extracting the **final** AppImage and obtaining the matching installed
binary packages, replay the actual release bundler's `patchelf` transformation:

```sh
python scripts/verify_linux_binary_provenance.py \
  --inventory /absolute/path/to/final-inventory/inventory.json \
  --patchelf /absolute/path/to/reviewed-patchelf \
  --patchelf-sha256 EXPECTED_PATCHELF_SHA256 \
  --apprun /absolute/path/to/reviewed-bundler-AppRun \
  --built-gui /absolute/path/to/final/chronoscope-desktop \
  --output /absolute/path/to/new-replay-evidence
```

The explicit patchelf hash pins the executable that will be **run**; review its
origin before use. The replay copies installed files to temporary locations,
reapplies the packaged RPATH, and compares complete output hashes. The WebKit
library also receives Tauri's `/usr` to `././` rewrite before RPATH patching.
The optional GUI argument verifies the build-tree executable via the same
RPATH replay; AppRun is matched byte-for-byte against the supplied tool. This
is stronger binary transformation evidence than build-ID matching, but it is
not proof that a distro source package produced the installed binary, that the
AppRun tool's source revision is available, or that replacement/relinking and
license obligations are met. Unmatched inputs remain unresolved, and the output
always retains `release_clearance: false`.

Run the additional focused test with
`python -B scripts/test_linux_binary_provenance.py`.
