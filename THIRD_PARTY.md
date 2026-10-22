# Third-party license and attribution index

The root [MIT license](LICENSE) covers independent Chronoscope application code, not every asset, dataset, dependency or capture. Mixed licensing does not automatically relicense unrelated code or forbid public-source hosting. Preserve adjacent notices, attribution links and modification records. This index is technical provenance, not legal clearance.

| Paths | Source / terms / handling |
|---|---|
| `assets/coastlines.json` | Natural Earth, public domain; simplified/rounded by `scripts/prepare_geography.py`. [Notice](assets/NOTICE.md). |
| `frontend/src/assets/earth-natural-earth.jpg` | Natural Earth II shaded relief with water, **public domain**, downsampled without color alteration. [Exact source, terms, hash and generator](assets/provenance/NATURAL-EARTH.md). No NASA image pixels remain in the current source texture. |
| `frontend/src/assets/egm96-15*` | Derived EGM96 geoid data, public domain for this specific grid; [conversion/provenance notice](frontend/src/assets/egm96-15-NOTICE.txt). |
| `tests/fixtures/cesium/synthetic-grid-z13.*` | First-party generated diagnostic artwork, **MIT**. [Fixture notice](tests/fixtures/cesium/README.md). Former EOX imagery and its derived documentation images are retired from HEAD. |
| `tests/fixtures/gis/box*` | Khronos/Cesium Box sample, © 2017 Cesium, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Wrapping/modifications in [GIS fixture notice](tests/fixtures/gis/README.md). |
| `tests/fixtures/terrain/synthetic-n43.dt0` | First-party mathematical fixture, **MIT**. No real DEM bytes; [formula, generation and limits](tests/fixtures/terrain/SOURCES.md). Former OSGeo sample removed from HEAD. |
| `samples/*black-rock*`; `samples/public/*black-rock*`; related captures | **Scott LaPoint (2026), Hudson Highlands Wildlife Connectivity Project**, [DOI](https://doi.org/10.5441/001/1.652), **CC BY 4.0**, subset/mapping changes; [portable/export credit](docs/DATA-ATTRIBUTION.md). |
| `samples/*usgs-global-earthquakes*`; corresponding `samples/public/*` | USGS-authored catalog data, public domain in the United States; commercial reuse permitted. [Exact source, filter, hashes and interpretation](docs/USGS-GLOBAL-EARTHQUAKES.md). |
| `samples/*police-uk-london-theft*`; corresponding `samples/public/*` | Police.uk, **Open Government Licence v3.0**, commercial reuse with attribution. Contains public sector information licensed under the Open Government Licence v3.0. [Source and interpretation](docs/CRIME-HOTSPOTS.md). |
| Other `samples/*.chronoscope`, `samples/public/*.csv` | NOAA/NHC/AIS government-source qualifications and CC0 wildlife deposits differ: [sources](samples/public/SOURCES.md), [wildlife](docs/WILDLIFE-DEMOS.md), [real demos](docs/REAL-WORLD-DEMOS.md). Synthetic fixtures are labelled separately. |
| `frontend/public/licenses/MapLibre-LICENSE.txt`; generated `frontend/public/{cesium,third-party}/`; `assets/licenses/` | Selected runtime license/NOTICE texts, not a proof of complete binary compliance. Cesium Apache-2.0 plus incorporated notices; MapLibre BSD-3-Clause; KaTeX/Marked MIT; ECharts Apache-2.0 + NOTICE/d3, zrender BSD-3; DOMPurify Apache-2.0 OR MPL-2.0. Knockout global lookup is modified from eval to globalThis by `frontend/vite.config.ts`, preserving upstream notice. |
| `vendor/glib/` | gtk-rs GLib 0.18.5, MIT with original [LICENSE](vendor/glib/LICENSE) and [COPYRIGHT](vendor/glib/COPYRIGHT); exact upstream two-line security backport, [provenance/maintenance record](vendor/glib/BACKPORT.md). Full vendored source is retained in source exports; these notice files are required in selected application notices. |
| `Cargo.lock`, frontend/video package locks | Exact package identity inventories, including optional/dev/target entries. MPL/native LGPL obligations depend on actual shipped components; selected permissive alternatives do not erase AND obligations. See [binary/source-access gate](docs/DISTRIBUTION.md). |
| `docs/screenshots/current/*.png`; application icons | Current native-app screenshots use public-domain Natural Earth relief, plus credited OpenFreeMap Streets in the gull-density, crime and vessel views, and identified public-domain/CC0 data or OGL v3.0 crime data. First-party UI/branding is MIT; dataset attribution remains applicable. [Gallery and credits](docs/screenshots/current/README.md) · [object ledger](docs/MEDIA-RIGHTS.json). Older screenshots, promo compositions, copied GSAP runtime and unproven audio were retired from HEAD. |

## Map and capture credit

Streets: [OpenFreeMap](https://openfreemap.org/) · [© OpenMapTiles](https://www.openmaptiles.org/) · [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Retain these links in online exports and corresponding readable URLs in print/video credits. Custom layers keep their own provider credits. Dataset credits also travel with shared projects/CSV companions.

## Historical material and binary distribution

Current source replaces the uncertain/noncommercial imagery, terrain sample, old capture collection, copied promo animation runtime and unproven audio. The [media ledger](docs/MEDIA-RIGHTS.json) preserves historical object evidence separately; a retired asset is not cleared by its removal. This standalone source snapshot imports no earlier Git ancestry, branches/tags or release attachments. Historical ledger entries are provenance metadata, not included historical payloads. No binaries have been published in this clean repository yet; source publication does not clear earlier or future executables.

Native LGPL/MPL source-access and other dependency obligations must still be checked against the exact future binary contents; see [distribution](docs/DISTRIBUTION.md). The root MIT license does not replace dependency or dataset terms.
