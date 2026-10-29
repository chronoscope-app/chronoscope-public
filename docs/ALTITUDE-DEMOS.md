# Altitude and multi-track examples

Open **Help → Demo datasets → A week of flights · 6 Philippine airports** or **128 Starlinks · global orbits**. Both are offline projects with Altitude, Time Height and Ground saved views. CSV copies are in `samples/public/`; keep their `.attribution.json` companions when sharing. No military missile telemetry is bundled.

| Example | Distinct tracks | Samples | Reported altitude |
| --- | ---: | ---: | --- |
| Philippine flights · March 1–7, 2026 UTC | 175 | 11,018 | 0–12,497 m (approximate reported height) |
| Starlink predicted orbits | 256 | 46,208 | 290,555–595,675 m (derived ellipsoid height) |

## Height controls and interpretation

The navigation height menu has one sliding segmented selector for **Time Height** and **Altitude**. Clicking either segment moves the selection. The elevation slider stays visible and is grayed out in Altitude, preserving the Time Height scale. Time Height at zero places Events on the terrain. Altitude is available in Globe; Time Height remains available in Time and Globe. Time Height's scale changes display elevation by timestamp. Altitude uses physical metres without time scaling or terrain exaggeration.

The importer recognizes altitude, height, elevation, geometric-altitude and unit-qualified column names. Select metres, feet or kilometres and verify the vertical reference:

- **WGS84 ellipsoid:** absolute ellipsoid metres.
- **Mean sea level · EGM96:** convert to ellipsoid height using the bundled EGM96 grid, independently of the terrain's datum/exaggeration.
- **Reported height · approximate:** place the source's reported metres directly on the ellipsoid; this is an explicitly approximate visualization, not a datum/pressure correction.
- **Unknown · retain, do not plot:** preserve source heights until the reference is resolved. Missing heights remain missing, and zero is a valid height.

Pressure altitude cannot be precisely converted to geometric altitude without additional atmospheric information. Neither demo claims that precision. In Altitude mode, Events without a usable height/location are omitted from the map; Event queries, filters, tables and analysis retain the complete dataset. Inferred locations are not used for physical altitude. Ground summary display effects are paused so clusters/heat maps cannot imply measured heights. Tracks connect retained samples with interpolated segments; they are not continuous measured trajectories. The loaded range/count in the menu describes the bounded render packet, not necessarily the whole dataset.

Event JSON stores `altitude: {meters, reference}`. CSV export includes `altitude_m` and `altitude_reference`; reimport maps both, preserving mixed references. Scalar projections/filtering/statistics support `altitude_m`; `altitude_reference` is categorical. Altitude and the saved mode require project format **7**. Formats 1–6 still load; older apps reject the newer format rather than silently discarding altitude. Existing WKT Z/M coordinates remain source geometry and are not automatically interpreted as altitude.

## Flights: source and transformations

[Authentic and Modified ADS-B Flight Data of Major Philippine Domestic Routes](https://doi.org/10.5281/zenodo.20534917), Alexander Bañados, University of the Philippines Diliman; also published as [Mendeley Data v1](https://doi.org/10.17632/tjh279d4f7.1), June 4, 2026. The author describes collection of the original-flight CSVs via Flightradar24 and licenses the derived dataset under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This does not imply endorsement.

Only the archive's `dataset/raw/` original-flight CSVs are used. Modified altitude/speed/position attacks, poison data and model-ready sequence windows are excluded. Five flights on each of five routes are selected per UTC departure date, spread across the available departure times. All 175 flights take place within **March 1–7, 2026 UTC**: first retained observation March 1 at 00:07:24, last March 7 at 23:58:20. The six airports are Manila (**RPLL**), Cebu (**RPVM**), Davao (**RPMD**), Iloilo (**RPVI**), Caticlan (**RPVE**) and Puerto Princesa (**RPVP**). This is a balanced illustrative subset of departures from Manila, not a complete airport schedule or a measure of traffic volume.

The example retains each flight's first and last rows and original rows at least 45 seconds apart, reducing 57,788 source rows to 11,018 observations. Timestamps, coordinates and `altitude_meters` values are preserved without date shifts, added interpolation or vertical corrections. The physical datum and upstream processing are unspecified, so heights use **reported/approximate metres**. Zero is retained as reported, not certified ground elevation. These are curated positions, not raw radio messages. Source filenames and row numbers remain inspectable, with aircraft type, airport codes and route attributes. Some upstream `flight_id` cells were converted to floating-point notation or `inf`; the intact hexadecimal IDs in the original filenames identify flights, while `source_flight_id` preserves the upstream cell.

The initial scene shows the entire week. Route colors distinguish the five destinations. For moving-window playback, restore **Day 1 · 24-hour playback window**, choose a **Day** increment in playback controls and press Play; the window can travel across the seven-day dataset. The other saved views show full-week Altitude, Time Height and Ground tracks. The portable workspace is about 339 KiB, with two actual-app preview thumbnails. The CSV is about 2.1 MiB and is not loaded separately by the demo picker.

[Source archive](https://zenodo.org/records/20534917/files/dataset.zip) (1,093,213,553 bytes). The published whole-archive MD5 is `4e10c93ea0a880ff75a1ecac57dc8fbc`; reproduction downloads only two pinned byte ranges totaling 49,623,330 bytes, so it does **not** claim to verify that whole-archive MD5. Each range is verified by SHA-256, each original ZIP member by length/CRC, and each selected original file is recorded with SHA-256 in [altitude-provenance.json](../samples/public/altitude-provenance.json). Large source regions remain ignored local fixtures. The previous London–Zurich sample is retired; historical validation reports retain its names and counts.

## Space examples and retired rocket sample

The five-JAXA-rocket example has been removed from the catalog and shipped samples. [Space demos](SPACE-DEMOS.md) replace it with 128 Starlink satellites and a 700-launch Falcon 9 history. Starlink uses predicted orbital states with an explicit MEME/J2000 frame assumption; Falcon 9 locations are launch pads and do not imply flight trajectories or measured altitude. Historical validation receipts retain the earlier dataset names and counts.

## Reproduce the flight example

Run `python3 scripts/prepare_altitude_demos.py INPUT_DIRECTORY --download`. This downloads about 50 MB of pinned source archive regions, verifies them, and regenerates the flight project, CSV, credit sidecar and source/output digest report. Subsequent runs omit `--download` to use the verified cached regions. No third-party Python packages are needed. The full 1.09 GB archive and its attack/training data are not bundled.

[CLI and MCP altitude controls](CLI-MCP.md#globe-height-selection-and-altitude-0161) share the same units, vertical references and saved modes.
