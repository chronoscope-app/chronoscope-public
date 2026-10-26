# Pinned priority-demo source inputs

Retrieved 26 October 2026. See [SHA256.json](SHA256.json) for exact input hashes and
[dataset interpretation and rights](../../../docs/PRIORITY-DEMOS.md).

| File | Original download |
|---|---|
| `usgs-2025.csv` | `https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2025-01-01&endtime=2026-01-01&minmagnitude=4.5&eventtype=earthquake&contributor=us&orderby=time-asc` |
| `viirs-south-america-2026-10-19-25.csv` | `https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs/csv/SUOMI_VIIRS_C2_Global_7d.csv` |
| `world-bank-electricity-1990-2023.json` | `https://api.worldbank.org/v2/country/all/indicator/EG.ELC.ACCS.ZS?format=json&per_page=20000&date=1990:2023` |
| `world-bank-countries.json` | `https://api.worldbank.org/v2/country?format=json&per_page=400` |
| `world-bank-electricity-metadata.json` | `https://api.worldbank.org/v2/indicator/EG.ELC.ACCS.ZS?format=json` |
| `natural-earth-countries.geojson` | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson` |
| `jhu-covid-confirmed-global.csv` | `https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/time_series_covid19_confirmed_global.csv` |

The FIRMS input is a bounded subset of the original 465,972-row global response:
retain all rows with −82 ≤ longitude ≤ −34, −56 ≤ latitude ≤ 13 and confidence
`nominal` or `high`. All 50,713 matching source rows and original fields are
preserved, including repeated detections. The original full-response hash is also
recorded. The other source inputs are unchanged response bodies. Use the checked-in
files to reproduce this exact capture; live URLs and catalog revisions can change.

Attribution: U.S. Geological Survey; NASA LANCE/FIRMS; World Bank / ESMAP / Tracking
SDG7 (CC BY 4.0); Natural Earth contributors (public domain); COVID-19 Data Repository
by the Center for Systems Science and Engineering (CSSE) at Johns Hopkins University
(CC BY 4.0). Keep the output CSV attribution companions with redistributed tables.
