# Balanced terrain — real pack validation

The real GMTED2010 pack is built on `feat/bundled-balanced-terrain` in
chronoscope-next. Raw inputs, Python/SDK/compiler caches and native packages stay
outside Git. No Public promotion, merge, release or hosted workflow was performed.
The original [handoff](../../handoffs/2026-10-24-balanced-terrain-clawcomp.md)
records the earlier synthetic-only checks and blocked cloud download.

## Measured data

| Item | Actual result |
| --- | --- |
| Compressed pack | 88,778,304 bytes (84.7 MiB) |
| Pack SHA-256 | `f93cdd806f477ebf73edb20212cd54089ea8b024cb2e4ba78e488554aa9377f8` |
| Finest grid | 21,600 × 10,800; exact one-arc-minute cell centres |
| Levels | Finest grid plus seven decimated overviews |
| Stored blocks | 2,721 across all levels; 1,854 at the finest level |
| Omitted finest blocks | 1,801 all-zero blocks |
| Finest height range | −412 to 8,495 EGM96 metres |
| Negative land cells | 160,353 |
| Land void cells | 0 in this actual input/mask; synthetic regressions cover void preservation |

Two independent local builds produced byte-identical archives and receipts.
The Python verifier checked the receipt SHA-256/size and every archive CRC; the
Node frontend build guard independently checked the receipt and source identity.
The pack is below GitHub's ordinary per-file limit and is committed as a regular
Git file. It stays compressed at runtime; the Rust decoder retains sixteen blocks
(2 MiB), plus bounded viewport/renderer caches.

## Actual source registration and independent checks

The 249 MB NetCDF download matches published MD5
`5b6c47502ae8d03b8718349655d5cd95`; its SHA-256 is
`5aef5bbaa5373d530752ad648c63aa2cc2b14d5a854fe5acf0a61fb8bacca7f8`.
Natural Earth's 10,157,965-byte mask matches the handoff SHA-256
`1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416`.

Inspection found 43,200 × 20,880 source cells, EGM96 metre units, fill value
−32768, and ascending CF latitude/longitude bounds. The archived ArcGrid has a
half-arc-second west/south offset and a rounded step of 0.008333333300000011°.
Its bounds are approximately −180.000138889°, −90.000138889°,
179.999859671°, 83.999860415°. The original proposed aligned 2×2 average was
therefore incorrect. The builder now verifies those actual CF bounds and uses
cell-overlap-weighted valid means, periodic longitude and nearest-even integer
metres on the exact target grid. It does not shift coordinates or treat fill as
valid terrain. All masked land falls within source coverage; the northern cap
beyond the source is ocean in this mask.

[`source-checks.json`](source-checks.json) records independent comparisons with
1,222 original-source cells. The validator does not import producer functions:
it intersects CF cell boundaries directly and tests land-cell intersection with
Shapely polygons. Named checks include Everest, Denali, the Andes, Alps, Dead Sea
(−412 m), Death Valley (−80 m), Netherlands (−5 m), coasts, both dateline sides,
Greenland, the Antarctic interior and both polar caps. These are sample-cell
means, not summit-height or survey-accuracy claims.

Every stored overview sample matches the corresponding retained finest sample;
every omitted overview block is all-zero. The generated 1,950 source-backed
Rust probes pass through the actual archive reader at all eight levels, including
the shortened periodic last interval at the coarsest levels. They exposed an
exact-first-post wrap/snap rounding bug, now fixed with a regression. Existing
synthetic tests still cover corruption, negative elevations and void boundaries.

## Local application and package checks

The complete Rust suite with the real pack passed **388 tests**, with one existing
ignored test. After the final decoder iterator modernization, all 22 focused
reader/lifecycle/hardening tests passed. A former failure test now uses invalid
latitude 91° instead of assuming terrain at (0°, 0°) is unavailable. CLI build and
generated contracts pass. Clippy passes with `-D warnings -A
clippy::nonminimal_bool`; the two pre-existing unrelated boolean findings remain
excluded as in the handoff. Rust 1.98's new constant-chunk iterator findings in
the reader and its fixture were fixed. Formatting and diff whitespace checks pass.

The frontend unit suite passes all 24 cases. Production TypeScript/Vite builds
pass with the real pack guard enabled. Packaging/distribution checks pass 23
cases, tester staging 34 cases, and final-download validation 36 cases. The Mac
configuration expectation now includes the terrain resource, and the archive
mutation test accepts the earlier inventory rejection while still requiring no
output. Workflows remain `workflow_dispatch` only. The bounded package cap is
256 MiB because the portable Linux runtime and actual terrain exceed the previous
60 MiB limit.

Real-data browser checks found two issues beyond synthetic fixtures: coarse
quantized hemispheres could be incorrectly horizon-culled, and square tile grids
caused excessive polar longitude work. Coarse complete tiles now use Cesium's
heightmap bounds, retaining real heights. Geographic packets use taller tiles
with a correspondingly coarser native tile level; narrow tiles retain source
longitude breaks and endpoints instead of inventing redundant columns. A
numerical regression preserves a source-column peak while bounding vertices.
The sub-metre projection cap at each pole is closed with the nearest real
sample instead of an invented zero-height vertex; a regression checks the
Antarctic pole. Custom Mercator DTED keeps its existing tile resolution and void
behavior.

The final [browser report](browser/browser-report.json) passes all six cases:
Globe, Map, Space-time, viewport refinement, Antarctica and Greenland. Every
scene finishes tile loading and renders at most one frame during its 1.2-second
idle measurement. Provider attribution is visible in the normal credits dialog.
External HTTP requests are blocked; none were attempted. Menu Unload survives a
server/page restart, menu Restore works, and save/open retains the built-in
identity in a **720-byte** workspace. Custom DTED replaces the built-in source,
remains undisplayed until its datum is explicitly chosen, renders within its
coverage, and retains its choice through restart and portable save/open. The
browser development bridge is reopened after external API edits because only
the native desktop subscribes to engine events.

The final Linux AppImage is **200,546,808 bytes (191.3 MiB)**, SHA-256
`1a497d14bfaa602be3f2ed34b87c9e08bf73b740bad8bbc7b17bb7d9755ab983`.
[Artifact checks](native/artifact-checks.json) inspect the actual extracted
AppImage: its physical terrain pack matches the committed SHA-256, its receipt
is identical and every archive CRC passes. The packaged desktop executable
passes headless CLI/agent/stdio-MCP smoke checks. The **AppImage itself** also
returns the real terrain metadata through stdio MCP, without a display. Release
resource discovery uses the packaged `usr/lib/Chronoscope/terrain/` location,
not a debug source-tree fallback.

The final AppImage launches under an isolated Xvfb/software-GL profile. Its
[attached GUI report](native/gui-report.json) confirms active EGM96 terrain and
zero renderer errors; [native app capture](native/appimage-globe.png) shows the
actual bundled GUI. The first-post Antarctic CLI sample is 2,801 m. The Linux
SDK was assembled locally from downloaded development packages and installed
runtime files, without sudo or system package changes. `package_linux.py` stages
WebKit helpers, strips relocated SDK paths and verifies the existing notices.
Native builds retain existing GLib lifetime warnings; no new error was waived.

Successful command logs are retained in [`logs/`](logs/), with trailing
whitespace normalized for repository checks. Earlier exploratory
failures were corrected and rerun; the original handoff's historical failures
remain in its archived evidence rather than being relabeled as passing.

## Reproduction

Exact producer and dependency versions are recorded in
[`build-environment.json`](build-environment.json). Use Python numpy, netCDF4,
rasterio and Shapely. Keep both raw inputs outside the checkout. Then run from this worktree:

```sh
python scripts/build_balanced_terrain.py SOURCE.nc4 LAND.geojson
python scripts/verify_balanced_terrain.py
node scripts/verify-balanced-terrain.mjs
python scripts/validate_balanced_source.py SOURCE.nc4 LAND.geojson
cargo test --locked -p chronoscope
cargo build --locked -p chronoscope --bin chronoscope
node scripts/generate_contracts.mjs
npm ci --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
npm run test:balanced-terrain --prefix frontend
python scripts/test_package_distribution.py
python scripts/test_tester_packaging.py
python scripts/test_validate_tester_download.py
npm run bundle -- --bundles appimage
python scripts/package_linux.py
```

Set `CHRONOSCOPE_CHROMIUM` and `CHRONOSCOPE_CLI` when using nondefault executable
locations. Browser evidence uses software WebGL with external HTTP blocked and
maps disabled; it is not a physical-GPU benchmark. Native evidence is Linux-only;
Windows/macOS packaging, signing and notarization were not exercised here.
