# Distribution payload and release gates

Chronoscope's first-party license does not relicense bundled libraries, data,
fonts, maps or media. Read [the root exceptions index](../THIRD_PARTY.md),
[data attribution](DATA-ATTRIBUTION.md), [asset notices](../assets/NOTICE.md)
and the upstream texts in [assets/licenses](../assets/licenses). Preserve their
scope and notices when redistributing. This is a packaging procedure, not a
legal clearance or a claim that every lock entry is shipped.

## Selected notice payload

The frontend prebuild/predev step runs `scripts/package-notices.mjs` through
`frontend/scripts/prepare-cesium.mjs`. It requires the root LICENSE,
THIRD_PARTY.md, this document, DATA-ATTRIBUTION.md, asset/license texts, EGM96
notice, demo guides and machine-readable demo provenance. It preserves their
repository-relative paths under `frontend/public/third-party/`, so references
such as `assets/NOTICE.md → ../docs/…` remain meaningful. Existing optional
root NOTICE/NOTICE.md, media-rights ledger, Black Rock CSV credit companion,
fixture README notices and `assets/provenance/` are also copied when present. It fails on missing required inputs, symlinks and
non-regular files, and replaces only its dedicated generated directory rather
than retaining stale notice files. It does not copy datasets or test imagery
into this notice directory. Links to source/data files outside the selected
payload require the matching source archive; not every guide link is bundled.

`NOTICE-MANIFEST.json` lists every copied file, byte length and SHA-256
(excluding the manifest itself). Vite copies this directory into the built
frontend; Tauri embeds that frontend. Verify the **actual built/extracted**
payload, not merely the repository's input directory:

~~~sh
node scripts/package-notices.mjs --prepare .
node scripts/package-notices.mjs --check frontend/public/third-party
python3 scripts/package_notices.py --check frontend/dist/third-party
~~~

The first command prepares notices only; it does not build Cesium or the app.
The full prebuild still requires the locked frontend dependencies. No manifest
is a signature, SBOM, complete copyright inventory, proof of source provision,
or evidence of the final binary's dependency closure. A modified payload and
recomputed manifest can pass: compare against trusted release hashes as well.

## Linux AppDir / AppImage

After the normal Tauri build, `scripts/package_linux.py` retains the existing
WebKit helper/GLES staging and distribution-documentation copying. It now
requires the three explicitly copied distro copyright records (libgles2,
WebKitGTK and JavaScriptCoreGTK), checks built notices against current checkout
inputs, and places a filesystem-accessible copy at:

~~~text
usr/share/chronoscope/third-party/
usr/share/chronoscope/NATIVE-NOTICE-MANIFEST.json
usr/share/doc/<distribution-package>/…
~~~

The native manifest hashes the selected app notice bundle and **all existing**
AppDir `usr/share/doc` files. It does not infer native licenses from Rust
binding licenses or erase notices supplied by linuxdeploy. Existing inspected
Linux AppImages already contain distribution copyright texts, and existing
Windows portable/installer artifacts already contain LICENSE/NOTICE material;
this change improves future payload coverage/verification, not a claim that
those prior packages had none. Historical assets are not retroactively changed.

Staging/verification can be exercised without running an AppImage or plugin:

~~~sh
python3 scripts/package_notices.py --appdir /path/to/Chronoscope.AppDir
python3 scripts/package_notices.py --check-appdir /path/to/Chronoscope.AppDir
python3 -B scripts/test_package_distribution.py
~~~

The finishing script still invokes the AppImage plugin when used normally.
Tests use temporary fake AppDirs and tiny fake frontend inputs only. They do
not launch that script, any plugin, installed app or downloaded executable.
Before release, read-only extraction of the final package must establish that
these files survived bundling and inventory every native library/helper/font
and installer/runtime component actually redistributed, including any outside
`usr/share/doc`. Hash checks on the staging tree do not prove final AppImage
contents, native source compliance, clean installation or runtime support.

## Corresponding source: MPL and native LGPL components

The selected notice bundle does **not** supply all dependency source. Binary
redistribution remains gated on a release-specific review and functioning
source-access mechanism; do not advertise an executable as cleared merely
because these scripts succeed. For each OS/architecture/feature set:

1. Record the release artifact SHA-256, exact application commit, locked
   dependencies, compiler/features and actual linked/bundled component versions.
   A complete lock-license inventory includes dev/optional/platform entries and
   is useful input, **not** target-specific legal compliance or linkage proof.
2. For MPL-2.0 covered files actually included (potential Cargo examples include
   cssparser, cssparser-macros, dtoa-short, selectors and option-ext), retain
   file notices and tell executable recipients how to obtain the **exact
   covered source**, including changes, under MPL. Provide a tested stable
   version-specific source location alongside release notices, or bundle that
   source. A general crates.io/GitHub homepage or Cargo.lock alone is not an
   established source-access mechanism. Review build-only/platform exclusions;
   do not assume every lock entry is in every executable. DOMPurify has an
   Apache-2.0 alternative; record any actual dual-license choice accurately.
3. For redistributed GTK/WebKitGTK/JSC/libsoup and other LGPL/mixed-license
   native files, use the precise distribution package **version and revision**
   and its source package, not the Rust binding's MIT label. Archive or reliably
   offer corresponding source including distro/local patches and needed build
   instructions. Evaluate each applicable license/version's notice, source
   delivery/offer and replacement/relinking requirements. Preserve the user's
   ability to modify/replace covered libraries and the required reverse-
   engineering permission; assess static linking, install information and
   signatures/launchers as applicable rather than assuming an AppImage's
   extraction option alone satisfies everything. Upstream URLs and three
   copyright files alone do not establish those obligations are met.
4. Ship a reviewed, release-specific source-access record with component name,
   exact binary/source versions, license choice, changes, source URL or bundled
   source path, retained source SHA-256, retrieval/rebuild instructions and the
   chosen source/relinking mechanism. Test recipient access without private
   credentials and retain any required source/offer for the applicable period.
   **No such complete native/MPL source record is generated by this change.**

macOS system frameworks are not automatically redistributed merely because
linked. Windows WebView2/installer redistribution must be reviewed separately.
Video-only Sharp/libvips tool entries do not prove desktop inclusion. Preserve
Apache NOTICE/AND-license obligations and independent data/media exceptions;
choosing one permissive option does not erase mandatory combined notices.

## Safe source ZIP

~~~sh
python3 scripts/package_source.py --output ../chronoscope-source.zip
python3 scripts/package_source.py --check ../chronoscope-source.zip
~~~

Git is required. The allowlist is the index's regular tracked file set, not a
recursive filesystem walk; untracked local files cannot enter the ZIP. Build,
cache and environment paths are excluded even if tracked (`.env.example` is
allowed). Exportable symlinks, symlinked ancestors, submodules, unmerged index
entries, unsafe names and case-colliding paths fail closed rather than being
dereferenced. Missing tracked files fail too. Output must be outside the
checkout and cannot be a symlink. A temporary ZIP is CRC/hash checked before
atomic replacement of the requested output.

`chronoscope/SOURCE-MANIFEST.json` records each included path/size/SHA-256 and
the base commit. It explicitly describes **working-tree** contents: tracked
local changes are included, so the base commit is not an assertion of pristine
commit equality. For a release, use a frozen clean reviewed checkout, add and
commit all intended new notice/provenance files first, inspect the ZIP list and
hashes, and retain the artifact digest separately. Packaging is not a secret
scanner or per-file license audit. A tracked sensitive file can still be
exported; the manifest does not clear it. The source ZIP preserves mixed-license
fixtures/media and their notices; it is not an all-MIT or unrestricted-use ZIP.
It is not automatically complete corresponding source for native dependencies.
Do not modify the checkout concurrently with export/staging.

## Checked tester prereleases

The manual tester workflow selects one standard public runner at a time and
requires the exact reviewed main SHA. No caches are saved; artifacts expire
after one day and each upload is capped at 256 MiB, accommodating the measured
84.7 MiB offline Balanced terrain pack plus the native app and, on Linux, the
self-contained WebKit runtime. Before dispatch, the release
coordinator verifies shared Actions/Packages usage and existing $0 hard-stop
budgets; a budget or storage denial is a stop, not permission for paid usage.
Intel macOS is deferred. macOS26 Apple Silicon uses installed Xcode26.6;
actual build/link results, not a claimed Xcode27 prerequisite, decide support.

`scripts/package_tester.py` requires a GUI installer/app/AppImage and validates
its executable architecture, desktop CLI/agent/MCP smoke behavior, and notice
payload. These checks run on hosted runners only. They do not claim real-device
acceptance or full GUI interaction coverage. Package validation records and
SHA256 sums accompany downloads. Windows installers do not bundle WebView2;
the user-installed Microsoft runtime is a prerequisite. macOS apps are ad-hoc
signed, not notarized.

Before publishing any executable, run `scripts/package_dependency_sources.py
--output ../chronoscope-dependency-sources.tar.xz` and attach that archive,
matching clean application source ZIP, selected notices and checksums to the
same prerelease. Every locked Cargo registry and frontend npm source archive
is hash-verified against its lockfile, including conservative optional/build
extras. Original license/copyright/NOTICE files remain within those archives;
SOURCE-ACCESS.json records exact public URLs, versions and hashes. The app
source ZIP supplies complete patched GLib and the Knockout transformation.
Covered MPL source is thus delivered alongside the executable rather than
relying on a generic upstream homepage. Apache alternatives are selected where
available; mandatory AND and data/media notices remain applicable.

Linux is not releasable until the exact extracted AppImage's native component
source/replacement gate above passes, including distro revisions and helpers.
Registry sources alone do not satisfy that gate. No Linux executable is cleared
merely because a build or hash check succeeds.
