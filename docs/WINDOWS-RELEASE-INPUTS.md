# Windows release source and resource coverage

The Windows installer uses the locked Tauri CLI, NSIS 3.13 and Tauri's
nsis-tauri-utils 0.5.3 plugin. Exact immutable source commits, binary archive
hashes, retained original license hashes and per-component hashes are in
`assets/licenses/windows-installer/PROVENANCE.json`.

NSIS's original COPYING covers its plugins **and graphics** under zlib/libpng;
its LZMA compression module is under CPL-1.0. The Windows release therefore
includes `chronoscope-windows-installer-sources.tar.xz`, containing original
NSIS source (including LZMA), the Tauri plugin source, and the exact Tauri source
for the generated installer template. Build instructions and original notices
remain in those archives. The matching application source ZIP and complete
locked registry archive supply application and static dependency sources.
Microsoft's SDK loader redistribution terms remain in the existing SDK notice
payload; the WebView2 browser runtime is a user-installed prerequisite, never
silently bundled by this configuration.

Before dispatch, run the following locally, using a dedicated ignored cache:

```sh
python scripts/windows_release.py preflight --output .qa/windows-inputs.json
node scripts/package-notices.mjs --prepare .
npm --prefix frontend run build
python scripts/windows_release.py frontend --output .qa/windows-web-files.json
```

This local input audit does not establish native Windows capabilities. The
Windows-only workflow preflight runs before compilation and requires the pinned
Rust/Node/Python families, MSVC x64 linker, Windows SDK headers/import libraries,
7-Zip, LLVM inspection, working file/directory symlinks, and installed WebView2.
It stages only checksum-reviewed NSIS inputs and refuses different existing
cached files without deleting them. No system policy is changed.

`package_tester.py` inventories **every** extracted installer file, including
`modern-wizard.bmp`, terrain data, metadata and notices. Unknown files and
changed upstream plugins/graphics fail closed. Every embedded frontend file is
also inventoried, including font, image, JSON, WASM and binary-grid assets;
untransformed registry/public inputs must match their source bytes. Generated
JavaScript/CSS/HTML is bound to the reviewed build configuration and locked
module sources. This build-time manifest is tied to the tested GUI executable;
it is not a claim to have extracted compressed web assets from that executable.

The independent hosted validator reconstructs the physical installer inventory
and requires exact equality with the producer's evidence. Source companions,
selected notices and all their hashes must accompany the new release and pass
anonymous download verification. Never treat a registry lockfile, an executable
extension filter, or a successful build alone as complete redistribution review.

Thin LTO and one release code-generation unit remain enabled. Source-verification
reuse includes the actual MSVC/Windows SDK identity; optional dependency caches
are retained in a matching namespace, rather than purged. A source or toolchain
change invalidates verified-work reuse. Existing releases and assets stay intact.
