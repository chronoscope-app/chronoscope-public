# Altitude and multi-track examples

Open **Help → Demo datasets → 100 flights · London to Zurich** or **128 Starlinks · global orbits**. Both are offline projects with Altitude, Time Height and Ground saved views. CSV copies are in `samples/public/`; keep their `.attribution.json` companions when sharing. No military missile telemetry is bundled.

| Example | Distinct tracks | Samples | Reported altitude |
| --- | ---: | ---: | --- |
| London–Zurich flights | 100 | 88,018 | 20.58–12,166.86 m |
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

[Cleaned ADS-B Trajectories (LHR-ZRH 2025) for AI Training](https://doi.org/10.5281/zenodo.18916312), Khalid El Ouanbi and Issam Amellal, LAMSAD Laboratory / Hassan First University; original telemetry from the OpenSky Network. The Zenodo record licenses this derived dataset under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This does not imply endorsement.

The source corpus has 2,465 separate flight CSVs. This example takes the first 100 CSV filenames in lexical order, retains every fifth source row and each final row, and identifies each flight by date plus callsign. It adds no interpolation. The upstream corpus already applies smoothing, anomaly removal, a constant −48 m correction and 1 Hz interpolation. Its column is named `GEOALTITUDE`, but its README describes corrected barometric altitude; the example therefore explicitly uses **reported/approximate** metres. These are processed observations, not raw ADS-B messages or independent 1 Hz measurements.

[Download CSV.zip](https://zenodo.org/records/18916312/files/CSV.zip) (364 MB), [upstream README](https://zenodo.org/records/18916312/files/README.md). Archive MD5 from the record: `c0e2531e7a887c7172f4a53f18a80ca4`. The large source archive stays outside Git.

## Space examples and retired rocket sample

The five-JAXA-rocket example has been removed from the catalog and shipped samples. [Space demos](SPACE-DEMOS.md) replace it with 128 Starlink satellites and a 700-launch Falcon 9 history. Starlink uses predicted orbital states with an explicit MEME/J2000 frame assumption; Falcon 9 locations are launch pads and do not imply flight trajectories or measured altitude. Historical validation receipts retain the earlier dataset names and counts.

## Reproduce the flight example

Download `CSV.zip` into a temporary input directory, then run `python3 scripts/prepare_altitude_demos.py INPUT_DIRECTORY`. The script verifies the pinned source hash, retains every fifth source row and each final row, and regenerates only the flight project, CSV and credit report. The 364 MB source archive is not committed.

[CLI and MCP altitude controls](CLI-MCP.md#globe-height-selection-and-altitude-0161) share the same units, vertical references and saved modes.
