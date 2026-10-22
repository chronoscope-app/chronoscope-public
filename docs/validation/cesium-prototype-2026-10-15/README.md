# Cesium prototype validation — 15–16 October 2026

This directory contains evidence from the **CesiumJS WebGL2 prototype**. Earlier Chronoscope reports elsewhere in the repository describe its original renderer and remain historical. Verification runs locally; no GitHub-hosted runner or paid SI service is used.

The consolidated local gate passed all 20 checks, including 207 Rust tests and eight browser suites. The full 28-check integration passed under the actual desktop CSP. The wrapped-Globe scale regression also passed: Greenwich and date-line views at the same camera scale both report zoom 14.06188574. The completed records below stand on their own; an installed provider or an assigned texture is not sufficient proof of visible rendering or correct displayed elevation. The map, terrain and context reports include native runtime evidence, with the measurement limits disclosed below.

## Completed evidence

| Evidence | What it establishes | Limits |
| --- | --- | --- |
| [Consolidated local validation](local-validation.json), [logs](logs) | All 20 local checks passed: formatting, Clippy, 207 Rust tests, generated contracts, frontend build, numerical checks and all eight browser suites | Linux software rendering; native platform checks are separate |
| [Rust checks](rust-207.json) | 207 Rust tests, formatting and strict core Clippy passed | Linux build; this does not test native Mac/Windows graphics |
| [Native build](native-build.json), [real Tauri GUI and MCP](native-gui.json) | Native Clippy/build/CLI smoke; actual WebKitGTK desktop launches with its isolated profile, attaches through stdio MCP and captures rendered hurricane tracks in space-time, 2D and Globe | Linux llvmpipe/Xvfb; no macOS/Windows, physical GPU, smartcard or packaging-signature certification |
| [Native worker proof](native-workers.json) | Actual Tauri custom-scheme heat and bloom workers produce visible pixels; uploaded DTED GPU top surfaces match the selected source model in Globe, 2D and Columbus | Linux WebKitGTK software rendering; nine terrain probes per mode, maximum observed deviation 0.954 m |
| [Million-row scale report](scale.json), [run log](scale.log), [Current screenshot gallery](../../screenshots/current/README.md) | One million original synthetic rows retained; exact queries/counts/member selection; native bounded clusters and visible pixels | Debug timings, one synthetic distribution, software GPU; no million-individual-marker FPS claim |
| [Ground-effect pixel report](ground-effects-pixels.json) | Visible heat and bloom pixels in native 2D, Columbus and Globe with annotations hidden; fixed-camera comparisons; ground remains fixed when time height changes | Synthetic ring contributions on the reference surface; approximate display effects, not calibrated scientific KDE |
| [28-check integration under desktop CSP](integration-final.json) | Real NOAA events, all native views, cursor zoom, picking/table selection, import/review, effects, live viewport declustering, active-terrain map zoom, playback, analysis and ±89° import/fit/native picking; zero CSP violations | Software GPU; wrapped-Globe scale is additionally checked by the WMTS suite |
| [WMTS/WKT integration](wmts.json) | Multiple saved servers/layers, local concurrent tile delivery, cache/offline reuse, opacity, zoom visibility, native shapes and terrain | Synthetic local tiles; zero public-provider requests; actual authentication hardware remains untested |
| [Local terrain surface](terrain-surface.json), [Current screenshot gallery](../../screenshots/current/README.md), [Current screenshot gallery](../../screenshots/current/README.md) | Native rendered top-mesh samples agree with the selected source/geoid interpretation; cached Sentinel imagery follows the real DTED surface in all geographic views | Coarse DTED fixture; EGM96 is an explicit test assumption for its generic MSL metadata; native seam-skirt caveat below |
| [One-arc-second DTED2 surface](terrain-dted2.json), [Current screenshot gallery](../../screenshots/current/README.md) | Higher-resolution public SRTM terrain, converted to standard DTED2, with the same cached imagery and independent source-height comparisons | SRTM/geoid/source and quantized-mesh error remain; this does not certify survey elevations |
| [2D context recovery](context-map.json), [Columbus recovery](context-space-time.json), [Globe recovery](context-globe.json), [Calendar recovery](context-calendar.json) | Real `WEBGL_lose_context` loss creates exactly one replacement Viewer and restores camera, data, selection, theme, terrain, imagery and bloom | Software GPU; simulated context loss does not cover every hardware/driver failure |

The scale run imported 1,000,000 rows in 213.2 seconds with the unoptimized Rust debug binary. Its initial default browser display showed **180 native clusters and at most 80 count labels**, representing all one million rows without creating a million Cesium Entities. A separate explicitly requested grid returned 2,632 cells; independent source-coordinate enumeration matched the tested 45-member cell and exact selection. Browser initial presentation took about 20 seconds on software graphics. Those timings are recorded for reproducibility, not release-build throughput or physical-GPU performance promises.

The focused effect test found the following changed native canvas pixels with the same camera, ground and disabled point/track annotations:

| Native mode | Heat pixels | Bloom pixels |
| --- | ---: | ---: |
| 2D Map | 74,245 | 26,933 |
| Columbus space-time | 37,997 | 13,365 |
| Globe | 63,136 | 21,624 |

The tested ground polygon changed by **zero pixels** when temporal display height changed. This is independent of `DisplayLayer.diagnostics`: the test compares actual rendered canvases after native imagery is ready. Ordinary scene imagery does not enter the event-emission worker. All these runs made zero public-provider requests.

The terrain runs sample actual native rendered triangle vertices/indices, excluding skirts, at nine locations in each of four geographic-view states. Maximum top-surface deviation from the selected source/geoid interpretation was **0.038 m** for the coarse fixture and **0.598 m** for the DTED2 fixture. These figures measure implementation agreement, not source accuracy. Off-seam native `globe.getHeight` samples agreed within 0.036 m and 0.623 m respectively; at exact tile seams that Cesium helper can hit a skirt, producing discrepancies up to **8.91 m**. Source terrain sampling remains the measurement API; visual mesh/skirt heights must not be used as analytical elevations.

The terrain screenshots replay one previously cached EOX Sentinel-2 cloudless 2024 WMTS tile at zoom 13, approximately **13.9 m/pixel** at Hamilton, Canada, over local DTED. These tests performed one local tile delivery and zero public tile fetches. Imagery attribution: **EOxCloudless by EOX IT Services GmbH; modified Copernicus Sentinel data 2024; CC BY-NC-SA 4.0 (non-commercial)**. This imagery license applies to the screenshots as well as the cached raster.

## Main integration coverage

The 28-check [Cesium integration suite](../../../frontend/scripts/cesium-parity-qa.mjs) exercises actual native modes and coordinates, cursor-anchored zoom, picking, continuous-table selection/search, camera/workspace persistence, time-only triangles, WKT, cluster member actions, live Columbus viewport refinement/declustering, visible effects, DTED/provider installation, imagery retention, Excel and CSV import, manual date/MGRS mapping, rejected-coordinate review, playback, analysis, charts, saved groups, editing/history, real ±89° polar import/fit/picking and light-mode help. Its linked 28-check report passed with zero uncaught errors, navigation failures, CSP violations or browser-side public requests. Native positions retained ±89° latitude to the tested 1e−9° tolerance, and actual native GPU picking found both polar events in 2D and Columbus. Opposite polar events are not jointly visible from a single Globe hemisphere; their native geographic positions and source rows remain intact.

The deeper [SI/MCP report](si-mcp.json), multiple-WMTS/cache/zoom, map-catalog, context-recovery and numerical resource suites also passed in the consolidated run. The [latest context/capture report](context-final.json) and [Current screenshot gallery](../../screenshots/current/README.md) additionally verify native UTC labels and the NASA attribution footer. The surface reports above compare actual native DTED top meshes with the selected source/geoid interpretation; a positive `terrainActive` diagnostic alone does not meet that requirement. See [the parity inventory](../../CESIUM-PARITY.md) for the code and test mapping.

## Data and image provenance

- The million-row source and effect contributions are explicitly synthetic.
- The offline reference image is NASA Blue Marble 2002, credited to NASA / Robert Simmon and Reto Stöckli. Its coarse pixels are reference imagery, not high-resolution street imagery or elevation. [Source record and public-data notes](../../../samples/public/SOURCES.md).
- Hurricane examples use original NOAA NHC HURDAT2 Atlantic records with NOAA IBTrACS basin filtering. [Dataset provenance](../../../samples/public/SOURCES.md#atlantic-hurricanes-20162025).
- Local DTED fixtures come from the NGA/NIMA sample distributed by GDAL. Generic `MSL` does not prove EGM96: tests that choose EGM96 must label it as an explicit interpretation unless their source confirms that datum. [GIS contract](../../GIS-ACCURACY.md).
- The bundled NGA EGM96 15-minute geoid grid is public domain. Centimetre encoding does not imply centimetre model accuracy. [Provenance and checksum](../../../frontend/src/assets/egm96-15-NOTICE.txt).
- Any EOX Sentinel-2 imagery added to this evidence retains **EOX / Copernicus Sentinel** attribution and its **CC BY-NC-SA** terms. An EOX raster screenshot is not covered merely by this repository's MIT source-code license; preserve the provider credit and applicable terms when sharing it. Local colored WMTS test rasters are synthetic and must be labelled accordingly.

## Reproduce locally

```sh
python3 scripts/validate_local.py --browser --report .qa/cesium-release/report.json
npm --prefix frontend run test:effects-pixels
# Opt-in disk/time-consuming million-row run; requires at least 2 GiB free:
npm --prefix frontend run test:cesium-scale
```

Native checks require the current operating system's Tauri SDK dependencies. A Linux software-rendered run cannot certify dedicated-GPU FPS, native macOS/Windows WebViews, physical smartcard/PIN interaction, signing or notarization. Source data, geoid accuracy, imagery resolution and hardware/driver behavior remain separate from numerical agreement and successful local tests.

### Sharing EOX-containing captures

EOxCloudless by [EOX IT Services GmbH](https://cloudless.eox.at/) / modified Copernicus Sentinel data 2024; [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). Rendered/reprojected/composited capture portions retain these noncommercial/share-alike conditions; independent application code does not thereby become NC-SA. Preserve source links and indicate capture modifications. Exact path/object evidence: [media ledger](../../MEDIA-RIGHTS.json).

> Historical images in this report were retired during the commercial-media cleanup. Text and measurements describe their original build; the current gallery is separate evidence.
