# Event and country-statistics demos

Help → Demo datasets includes 13 offline projects. In addition to the six original
movement demos, the picker now includes the website's January earthquake and
London theft examples, the shorter hurricane workspace, a new COVID reference
example, and three priority datasets:

| Demo ID | Source observations | Default experience |
|---|---:|---|
| `earthquakes` | 8,500 USGS-authored events, 2025, reported magnitude ≥4.5 | Pacific globe and world/regional epicenters; fixed magnitude colors |
| `fire-detections` | 50,713 VIIRS S-NPP detections, 19–25 October 2026 | South America bounding-box heat weighted by reported FRP (MW), plus original detections |
| `electricity-access` | 5,746 country-year rows, 169 mapped countries, 1990–2023 | Country polygons in a fixed 0–100% scale; 2023 and historical saved views |
| `covid` | 6,509 cumulative-count observations at 283 administrative reference locations | Sunday snapshots, January–June 2020; starts at 28 June |
| `earthquakes-january` | 652 events, January 2025 | Original website earthquake showcase, now discoverable in Help |
| `london-crime` | 4,053 reports, January 2025 | Original website heat/count-cell showcase, plus individual reports |
| `hurricanes-short` | 1,604 fixes, 38 storms, 2021–2025 | Existing five-season hurricane project |

The new event and statistical demos have tracks and stems off. Every picker image
opens its actual saved view and filter, including the year. The original hurricane
Time image now opens its saved space-time view instead of a second flat map.

## Measurement colors

Views → Color by value configures a fixed minimum, maximum, title and unit suffix.
It colors individual event points and source polygons, with a persistent legend.
The scale supports negative values and does not rescale when filtering. Gray means
no numeric observation, not zero. The scale and legend survive saved views and
portable workspace saves. Entity colors remain available from the same dialog.
Switching to heat, density, clustering or bloom clears the measurement style so a
numeric event legend cannot be mistaken for an intensity/count legend.

The electricity demo joins World Bank `EG.ELC.ACCS.ZS` country codes to Natural
Earth's generalized 1:110m boundaries (`WB_A3`, with `ISO_A3_EH` fallback). Regional
and income aggregates are excluded. Small economies missing from this boundary
scale and unmatched boundaries are listed in
[the join report](../samples/public/priority-demo-provenance.json). The demo is not
complete coverage of every World Bank economy. Current boundary outlines are reused
for all years; they are not historical political boundaries.

Annual observations use 1 January UTC solely as a year display anchor, not a measurement instant. Saved electricity maps filter to one calendar year. If the time window spans
multiple years, the map shows each country's **latest observation in the window**;
a missing value in that latest year remains gray. It never sums or blends annual
percentages. Source rows stay available to tables and charts. The saved bar chart
uses the mean of visible country-year values; at the default single year, this is
the reported annual percentage. For a multiyear chart, the chosen aggregate applies
to all matching source rows, independently of the map's latest-record display.

## Sources and interpretation

- **Earthquakes:** [USGS FDSN catalog](https://earthquake.usgs.gov/fdsnws/event/1/).
  The query returned 8,556 events; 8,500 have `net`, `locationSource` and `magSource`
  all equal to `us`. This is a complete calendar-year selection under those source
  and magnitude rules, not a complete inventory of all earthquakes. Surface
  epicenters are shown; source depth is retained in km. Magnitude types vary.
  USGS-authored data is public domain in the United States.
- **Fires:** [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/active_fire/), VIIRS
  S-NPP 375 m Collection 2 NRT. The fixed subset keeps every nominal/high-confidence
  detection inside longitude −82…−34°, latitude −56…13°, from the seven-day CSV
  retrieved on 26 October 2026. No deduplication, thinning or interpolation. The
  region is a bounding box, not a country mask. Detections can repeat the same fire
  across overpasses and can include other thermal anomalies. Heat sums reported
  fire radiative power in MW, not burned area, unique fires or severity. The saved heat view saturates at 300 smoothed kernel units for readable contrast; this display ceiling does not cap source values or claim a measured regional power total. Cloud,
  observation timing and sensor coverage affect density. This working demo uses a
  frozen week, **not the proposed month or fire season**; historical FIRMS archive
  downloads require Earthdata registration. The live URL will change; checked-in
  source rows reproduce this exact snapshot.
- **Electricity:** [World Bank electricity access](https://data.worldbank.org/indicator/EG.ELC.ACCS.ZS),
  World Bank / ESMAP / Tracking SDG7, CC BY 4.0; [Natural Earth countries](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/),
  public domain. Values are annual percentages of population with access, with no
  missing-value filling. The 5,746 mapped country-year rows include 677 missing
  values. Boundary coordinates are normalized to six decimal places.
- **COVID:** [JHU CSSE COVID-19 Data](https://github.com/CSSEGISandData/COVID-19),
  Johns Hopkins University, CC BY 4.0. Sunday columns from the archived global
  cumulative confirmed-case table, January–June 2020. Original counts and reference
  coordinates are retained; missing coordinates and `(0,0)` references are excluded.
  These are cumulative administrative reports, not new weekly cases or individual
  case locations. Date-only observations use UTC display anchors. Testing and
  reporting definitions differ across places and time. This is a newly prepared
  example, not a recovered old Chronoscope COVID file.

Dataset credits are embedded in the portable projects and mirrored in each CSV's
`.attribution.json` companion. No provider logo or endorsement is implied.

## Reproduction and verification

The pinned inputs, original download URLs and SHA-256 checksums are in
[source-snapshots](../samples/public/source-snapshots/README.md). With Python and
`shapely==2.2.0`, run:

```sh
python3 scripts/prepare_priority_demos.py
python3 scripts/prepare_showcase_demos.py
cargo build --locked
node scripts/generate_contracts.mjs
npm --prefix frontend run build
cargo test --locked --test priority_demos --test real_demos
node frontend/scripts/priority-demos-qa.mjs
node frontend/scripts/capture-demo-thumbnails.mjs
```

The showcase preparation script adds saved display views to the January earthquake
and crime files without changing source observations. Their original CLI import
reproduction scripts remain available. All generated new projects reopen through
the ordinary project validator and demo loader. Browser checks use the actual Rust
bridge, Cesium and blocked external network requests. Captures are real application
screenshots on Chromium/SwiftShader, not native macOS/Windows validation or a
physical-GPU performance claim. No GitHub-hosted workflows are used.

The website's additional owner-supplied terrain image has no identified matching
portable project. Synthetic terrain decoder fixtures were not represented as that
real-world showcase dataset.
