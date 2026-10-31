# Real-world samples

Open **Help → Demo datasets** for all 15 bundled offline projects, including the website earthquake and crime examples. [New event/statistics demos, sources and interpretation](../docs/PRIORITY-DEMOS.md). You can also open these files directly:

- `animal-gps-black-rock-forest-2023-03.chronoscope`: 3,439 observations of two bobcats and one fisher in New York.
- `animal-gps-white-storks-2018.chronoscope`: 6,090 observations of three migrating storks.
- `animal-telemetry-elephant-seals-2004.chronoscope`: 15,501 dive summaries from three seals, with maximum depth and duration attributes and a saved depth chart.
- `noaa-ais-san-francisco-2024-01-01.chronoscope`: 8,473 NOAA AIS observations from ten San Francisco Bay vessels, with four saved views.
- `animal-gps-herring-gulls-2021-06.chronoscope`: 15,697 GPS observations from three Belgian herring gulls, with four saved views.
- `atlantic-hurricanes-2016-2025.chronoscope`: 3,568 original NHC best-track observations for 83 storms, with saved display views.
- `atlantic-hurricanes-2021-2025-tracks.chronoscope`: a shorter hurricane workspace.
- `usgs-global-earthquakes-2025-01.chronoscope`: 652 global earthquake epicenters, magnitude ≥4.5, January 2025; also available in the demo picker. [USGS source and interpretation](../docs/USGS-GLOBAL-EARTHQUAKES.md).
- `police-uk-london-theft-2025-01.chronoscope`: 4,053 anonymised London theft reports, January 2025, with a heat-map view; also available in the demo picker. [Police.uk source and credit](../docs/CRIME-HOTSPOTS.md).
- `usgs-global-earthquakes-2025.chronoscope`: 8,500 USGS-authored earthquakes, magnitude ≥4.5, over 2025; Pacific globe and regional views.
- `nasa-firms-south-america-2026-10.chronoscope`: 50,713 VIIRS detections in a South America bounding box, 19–25 October 2026; FRP-weighted heat and original points.
- `world-bank-electricity-1990-2023.chronoscope`: 169 mapped countries over 34 annual observations, with fixed percentage coloring and missing values preserved.
- `flights-philippines-week-2026.chronoscope`: 11,018 samples from 175 distinct flights across six Philippine airports, March 1–7, 2026 UTC; reported altitude, Time Height and ground views.
- `starlink-128-predicted-orbits-2024.chronoscope`: 46,208 original predicted states from 128 satellites over six hours, with altitude and Time Height views.
- `kabr-uav-kenya-2023.chronoscope`: three complete KABR UAV flights on their original January 2023 UTC dates, in one layer. Opens on January 12 only, with Time and takeoff-relative Globe views. [Source, height interpretation and reproduction](../docs/KABR-UAV-DEMO.md).
- `public/*.csv`: matching importable observation tables.

See [wildlife sources and interpretation](../docs/WILDLIFE-DEMOS.md), [real-world demos, sources, units and reproduction](../docs/REAL-WORLD-DEMOS.md), [hurricane provenance](public/SOURCES.md), and [hurricane guide](../docs/NOAA-HURRICANE-DEMO.md). The source data is embedded in each project; map imagery is referenced rather than embedded. Normal startup remains empty.

Small synthetic import/GIS and terrain decoder fixtures live under `tests/fixtures/` for deterministic regression checks. They are not example studies.
