# Selected showcase: credits and capture provenance

These 16 screenshots were selected from the delivered **October 22, 2026 Chronoscope simple gallery**. Picture numbers below are its visible numbered headings, not catalog sort positions. Titles are preserved in the root README.

Capture source: Chronoscope **0.15.2**, commit `915de1cff20fb465e5d78bdd6a49e9d1cec10257`. Renderer recorded by the capture manifest: Native Linux Tauri / WebKitGTK / Cesium WebGL2, software GPU. These are application screenshots, not a hardware-performance or cross-platform acceptance test.

The canonical gallery images are **full-resolution 1920 × 1200 PNGs**, converted losslessly from the exact selected WebP payloads in the simple gallery and original showcase. Every decoded RGBA pixel is identical to its selected source; no recapture, resize, enhancement or generated content was applied. The original WebP files remain as unused provenance assets. The standalone HTML gallery is not part of this repository.

## Picture order

| Gallery picture | Title / image | View |
| --- | --- | --- |
| 1 | [A migration drawn through time](01-storks-migration-time.png) | Space-time |
| 4 | [Three birds, three journeys](04-storks-map.png) | 2D Map |
| 6 | [August departure](06-storks-august.png) | Space-time |
| 12 | [Ocean journeys](12-seals-ocean.png) | 2D Map |
| 17 | [Along the Belgian coast](17-gulls-coastal-tracks.png) | 2D Map |
| 20 | [Coastal movement through June](20-gulls-space-time.png) | Space-time |
| 23 | [Approaching the waterfront](23-ships-port-close.png) | 2D Map |
| 24 | [A day of traffic in three dimensions](24-ships-space-time.png) | Space-time |
| 27 | [Vessel types and recorded speed](27-ships-speed-chart.png) | 2D Map |
| 28 | [A decade across the Atlantic](28-hurricanes-atlantic-globe.png) | Globe |
| 35 | [The Pacific Ring of Fire](35-earthquakes-pacific.png) | Globe |
| 41 | [London heat map in daylight](41-crime-london-light.png) | 2D Map |
| 42 | [Published reports as count cells](42-crime-density.png) | 2D Map |
| 54 | [Dive depths beside ocean tracks](54-compact-seals-depth-chart.png) | 2D Map |
| 56 | [Coastal GPS with a compact speed chart](56-compact-gulls-speed-chart.png) | 2D Map |
| 57 | [Bay traffic with a compact comparison](57-compact-ships-speed-chart.png) | 2D Map |

## Data sources and interpretation

### Storks — pictures 1, 4, 6

6,090 GPS fixes · 3 white storks · July–September 2018.

Three white storks, Europe to North Africa. Vertical height encodes UTC time; the lines connect recorded GPS fixes.

**Data:** [Fiedler, Flack, Schäfle et al. (2019), LifeTrack White Stork SW Germany, Movebank / moveVis. CC0 1.0. doi:10.5441/001/1.ck04mn78.](https://doi.org/10.5441/001/1.ck04mn78).

### Seals — pictures 12, 54

15,501 dive summaries · 3 northern elephant seals · 2004.

15,501 published dive summaries from three northern elephant seals. Map positions are modeled dive-start locations; depth remains an attribute.

**Data:** [Costa, Daniel; Holser, Rachel; Keates, Theresa; et al. Northern elephant seal tracking and diving — processed data. Dryad (2025). CC0 1.0. doi:10.7291/D18D7W.](https://doi.org/10.7291/D18D7W).

### Gulls — pictures 17, 20, 56

15,697 GPS observations · 3 herring gulls · June 2021.

15,697 June 2021 GPS observations of three herring gulls. Stienen et al. / INBO / LifeWatch, CC0. Connected fixes do not establish continuous routes.

**Data:** [Stienen et al. (2022). HG_OOSTENDE v4. INBO / LifeWatch / VLIZ. CC0 1.0. doi:10.5281/zenodo.6594838.](https://doi.org/10.5281/zenodo.6594838).

### Vessels — pictures 23, 24, 27, 57

8,473 AIS observations · 10 vessels · San Francisco Bay, 2024.

8,473 AIS observations, 1 January 2024. NOAA / USCG / BOEM / MarineCadastre. Colors distinguish vessels. Recorded samples, not independent voyages; not for navigation.

**Data:** [NOAA Office for Coastal Management / USCG Navigation Center / BOEM / MarineCadastre, AIS 2024. Selected San Francisco Bay observations. Government-sourced data; NOAA use constraints: for coastal and ocean planning.](https://coast.noaa.gov/digitalcoast/data/vesseltraffic.html).

### Hurricanes — picture 28

3,568 source observations · 83 Atlantic storms · 2016–2025.

3,568 original NHC best-track observations for 83 storms, 2016–2025. Colors help separate storm tracks. Tracks connect reported fixes; maximum sustained wind is in knots.

**Data:** [NOAA National Hurricane Center, Atlantic best-track data, 2016–2025. Source positions and wind observations preserved.](https://www.nhc.noaa.gov/data/#hurdat).

### Earthquakes — picture 35

652 source events · Reported magnitude ≥4.5 · January 2025.

652 USGS-authored earthquakes of reported magnitude ≥4.5, January 2025. Surface epicenters; depth is an attribute. One globe view shows one hemisphere.

**Data:** [U.S. Geological Survey. USGS-authored January 2025 catalog data, magnitude ≥4.5. Public domain in the United States.](https://earthquake.usgs.gov/fdsnws/event/1/).

### Crime — pictures 41, 42

4,053 published reports · Approximate locations · January 2025.

4,053 Police.uk theft-from-the-person reports, January 2025. Locations are anonymized approximations; dates resolve to the month. Picture 41 shows smoothed source-record counts; picture 42 shows counts in display-grid cells at this zoom. These are not population-adjusted risk scores. OGL v3.0.

**Data:** [Police.uk / Single Online Home National Digital Team and contributing police forces. Contains public sector information licensed under the Open Government Licence v3.0.](https://data.police.uk/about/).

## Map credits

- **Pictures 1, 4, 6, 12, 28, 35, 54:** Natural Earth II shaded relief and water · public-domain reference artwork.
- **Pictures 17, 23, 24:** Esri World Imagery · Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community.
- **Pictures 20, 27, 41, 42, 56, 57:** Esri World Street Map · Sources: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), Esri Korea, Esri (Thailand), NGCC, (c) OpenStreetMap contributors, and the GIS User Community.

Map credits above are preserved from the capture catalog. Data and map content retain their respective terms; inclusion here is not blanket third-party license clearance. See [repository third-party notices](../../../THIRD_PARTY.md), [bundled demo sources](../../../samples/public/SOURCES.md), and the linked source providers. The Police.uk material contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
