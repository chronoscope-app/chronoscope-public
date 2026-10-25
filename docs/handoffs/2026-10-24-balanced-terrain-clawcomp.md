# Continue Balanced terrain on clawcomp

Continuation results and the real measured pack are recorded in
[the validation report](../validation/balanced-terrain-2026-10-24/README.md).
The remainder of this handoff preserves the original pre-download state.

## Goal and authority

The user requested global Balanced terrain bundled with Chronoscope, selected
automatically for new profiles, with persistent unload, restore and replacement
by user terrain. Balanced means one arc-minute sample spacing (approximately
1.9 km north–south). The chosen source is public-domain USGS/NGA GMTED2010,
with a Natural Earth land mask; ocean-only blocks are omitted. The user then
explicitly requested transfer of this work to their connected Codex system
`clawcomp` because the cloud executor blocks the source download.

Continue the existing implementation; do not rebuild it from scratch. Read
`AGENTS.md`. Develop and validate in `chronoscope-app/chronoscope-next`. Do not
promote to `chronoscope-public`, merge the incomplete work into main, or dispatch
GitHub Actions. Public promotion needs explicit user authorization. This branch
is an incomplete handoff, not a release. No completed world pack or measured
compressed size is claimed.

## Checkout

Repository: `https://github.com/chronoscope-app/chronoscope-next.git`

Branch: `feat/bundled-balanced-terrain`

Base main: `59a0e0b3516ab51e595d133fd50619804b506535`.

From an existing Next checkout, fetch and create an isolated worktree so existing
local changes are preserved:

```sh
git fetch origin feat/bundled-balanced-terrain
git worktree add -b codex/clawcomp-balanced-terrain ../chronoscope-balanced-clawcomp origin/feat/bundled-balanced-terrain
```

Choose another new worktree/branch name if either already exists; do not reset or
overwrite another task. A fresh clone can use `git clone --branch
feat/bundled-balanced-terrain https://github.com/chronoscope-app/chronoscope-next.git`.

## Implemented

- `scripts/build_balanced_terrain.py`: checksum-verified source conversion into
  independent DEFLATE-compressed signed-metre blocks, reversible horizontal
  differencing, land masking and seven decimated overview levels. It writes
  `assets/terrain/balanced.cterrain` and `balanced.json` (size/hash/provenance).
- `src/balanced_terrain.rs`: bounded archive reader, lazy decode, 16-block LRU,
  periodic dateline sampling, void/negative-height handling and grouped sampling
  to avoid cache churn. `src/terrain.rs` integrates it into the existing catalog.
- `terrain_builtin` preference: true for new profiles; missing in older saved
  preferences means false. Known EGM96 datum is automatic for the built-in
  source. User DTED replacement clears the built-in choice and requires that
  source's own datum. Existing explicit unload/custom preferences persist.
- Terrain UI labels, Unload, Restore bundled terrain, custom DTED replacement,
  bundled attribution, geographic mesh registration and polar sampling.
- Portable save/reopen references built-in terrain by identity rather than
  copying the world pack into every document. Embedded user DTED remains portable.
- Tauri resource paths for Linux/Windows/macOS (including the macOS override),
  and resource discovery before desktop/CLI initialization.
- Build guards refuse a missing/stale pack or receipt. Do not disable these
  guards to make the incomplete branch appear buildable.

## Immediate next step: obtain the real source

The blocked cloud executor's proxy returned CONNECT 403 for `zenodo.org` and
also denied USGS downloads. Its allowlist contained only OpenFreeMap plus the
package-manager preset. `clawcomp` may have ordinary network access; check there.

Download source inputs outside the repository, for example to a task-specific
scratch directory:

```sh
mkdir -p ../balanced-terrain-inputs
curl --fail --location --output ../balanced-terrain-inputs/GMTED2010_mean_30arcsec.nc4 'https://zenodo.org/records/14537811/files/GMTED2010_mean_30arcsec.nc4?download=1'
curl --fail --location --output ../balanced-terrain-inputs/ne_10m_land.geojson 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
```

GMTED source published MD5: `5b6c47502ae8d03b8718349655d5cd95` (approximately
249 MB download). The builder enforces it and records SHA-256 too. Source record:
https://zenodo.org/records/14537811 .

The Natural Earth file already downloaded in the cloud was 10,157,965 bytes,
SHA-256 `1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`.
Verify the newly downloaded input matches; if upstream changed, inspect and
record the new provenance rather than claiming reproduction of the old input.
The scratch copy and compiler/dependency caches are not required to transfer.

Use a local Python virtual environment with `numpy`, `netCDF4` and `rasterio`.
Then, from the checkout:

```sh
python scripts/build_balanced_terrain.py ../balanced-terrain-inputs/GMTED2010_mean_30arcsec.nc4 ../balanced-terrain-inputs/ne_10m_land.geojson
python scripts/verify_balanced_terrain.py
node scripts/verify-balanced-terrain.mjs
```

The producer has not yet been exercised on the actual NetCDF file. Inspect its
variable names, masks, coordinate registration and height units if conversion
rejects the file. Preserve datum, voids, negative land, and exact cell registration;
do not relax those validations or substitute synthetic terrain as product data.

## Finish and verify

1. Verify sampled land heights independently against the source, including
   mountains, below-sea-level land, coastlines, the dateline and polar regions.
   Validate the actual producer/reader together, overview alignment and ocean
   omission. The previous tests used synthetic pack fixtures only.
2. Report actual pack bytes from `balanced.json`; the earlier 50–125 MB range
   (about 75 MB planning figure) was an estimate. Verify reproducible generation
   and both archive CRC and receipt hashes. Keep large raw inputs outside Git.
3. Use Rust 1.96+ and the retained lockfiles. Install frontend dependencies with
   `npm ci --prefix frontend`, run `cargo test --locked -p chronoscope`, regenerate
   contracts via `node scripts/generate_contracts.mjs` after building the CLI,
   run `npm test --prefix frontend`, `npm run build --prefix frontend`, and
   `python scripts/test_package_distribution.py`. Rerun the full core suite with
   the actual pack present: older tests that assumed fresh profiles have no
   terrain may need to assert preserved initial state instead.
4. Test the real UI: fresh profile has terrain without downloads; Unload survives
   restart; Restore works; custom DTED replaces it; save/reopen preserves the
   choice without duplicating the world pack; attribution is visible. Verify
   Globe/Map/Space-time, polar views, viewport refinement and idle rendering.
5. Build/inspect the native package on the available OS. Confirm the physical
   terrain resource/receipt is included and found by installed GUI and CLI/MCP.
   Preserve manual-only workflows and existing packaging safeguards.
6. Update `assets/terrain/README.md` and the validation report with measured size
   and actual checks. Commit the derived pack, receipt and final fixes to Next's
   feature branch. If the pack exceeds GitHub's ordinary per-file limit, choose
   an explicit reproducible artifact strategy rather than silently omitting it.
   Do not publish Public without the user's promotion instruction.

## Existing evidence and limits

See `docs/validation/balanced-terrain-2026-10-24/README.md` and `evidence/` beside
this file. The final focused run passed 80 Rust tests, 24 frontend test cases,
and 23 packaging tests. TypeScript and formatting passed. Clippy passed with
`-D warnings -A clippy::nonminimal_bool`; strict Clippy found two pre-existing
nonminimal boolean findings in unrelated files. The initial broad Rust run had
384 passes and two failures subsequently fixed and checked in the focused run;
do not relabel that original invocation as passing.

The real pack/receipt, source-coordinate comparison, measured size, real-data
visual QA and native package build are still outstanding. Production frontend
build currently fails deliberately at the missing-receipt guard.
