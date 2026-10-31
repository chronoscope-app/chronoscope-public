# Hurricane sample provenance

## Atlantic hurricanes, 2016–2025

`atlantic-hurricanes-2016-2025.csv` contains 3,568 original NHC HURDAT2 best-track records for 83 storms reaching hurricane strength while in the Atlantic basin. The source is https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-02272026.txt (SHA-256 `1b9b0c7beed5b4505838658b1d30e159fc84330c60891a58cfcf43ae55c37202`). NOAA IBTrACS v04r01 BASIN tags remove Pacific portions of crossover tracks; Bonnie 2022 is excluded because it became a hurricane only in the Pacific. Original track times/coordinates are preserved, without interpolation. Full lifecycle phases within the Atlantic are retained. Wind is knots, central pressure is millibars, and missing pressure sentinel values become blank cells. See [the demonstration guide](../../docs/NOAA-HURRICANE-DEMO.md) and its capture metadata for the basin-reference digest, screenshots, interpretation and map provenance. `samples/atlantic-hurricanes-2016-2025.chronoscope` embeds these records and four display bookmarks; NASA imagery is referenced rather than embedded.

## NOAA AIS and animal GPS

The two additional CSVs and portable projects are bounded real-world examples. Source citations, licenses, selection rules, units, original timestamp handling and reproduction commands are in [Real-world demos](../../docs/REAL-WORLD-DEMOS.md). Machine-readable source/output SHA-256 digests and exact subset definitions are in [demo-provenance.json](demo-provenance.json).

## Bobcats/fisher, white storks and elephant seals

See [Wildlife demo sources, licenses, units and transformations](../../docs/WILDLIFE-DEMOS.md) and [machine-readable wildlife provenance](wildlife-provenance.json). Seal depth is a dive-summary attribute; positions are modelled dive-start locations.

## Global earthquakes

The fixed January 2025 USGS-authored earthquake sample has worldwide coverage. [Selection, rights, hashes and reproduction](../../docs/USGS-GLOBAL-EARTHQUAKES.md). Share the CSV with its attribution companion.

## Crime hotspots

Police.uk theft-from-the-person reports in central London, January 2025, OGL v3.0. Contains public sector information licensed under the Open Government Licence v3.0. [Selection, hashes, credit and reproduction](../../docs/CRIME-HOTSPOTS.md).


## SpaceX examples

`starlink-128-predicted-orbits-2024.csv` retains 46,208 original predicted states from 128 satellites in MAD-LEO v1 (Guo et al., CC BY 4.0; SpaceX operator ephemerides). `falcon9-launch-history-2010-2026.csv` retains 700 GCAT Falcon 9 launch records across three pads (Jonathan McDowell, CC BY 4.0). Keep both attribution sidecars. See [coordinate assumptions, source checksums and the full 43-million-state fixture](../../docs/SPACE-DEMOS.md).

## A week of Philippine flights

`flights-philippines-week-2026.csv` retains 11,018 original altitude observations from 175 flights across six airports, March 1–7, 2026 UTC (Alexander Bañados, CC BY 4.0). Only the source archive's original-flight files are used; modified and poison data are excluded. Heights are approximate reported metres with unspecified physical datum. Keep its attribution sidecar. [Selection, source checksums and reproduction](../../docs/ALTITUDE-DEMOS.md).

## IDF fixed-wing UAVs

[IDF_DS v1.0 · García Gascón et al. / UPV, Instituto IDF](https://doi.org/10.5281/zenodo.16992976), CC BY 4.0 according to the Zenodo record. The demo retains 399,331 positions from every usable processed GPS log. [Source inventory and time/altitude interpretation](../../docs/IDF-UAV-DEMO.md). Original GPS fields and counters are retained.
