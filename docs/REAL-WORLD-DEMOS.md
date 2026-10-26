# Real-world demo datasets

Open **Help → Demo datasets** in any installed Chronoscope build. These offline examples are compiled into the engine and work through the desktop, CLI and MCP. Each opens a new editable workspace; **Save** asks for your own file. Bundled originals are never overwritten. Normal startup remains empty. Map imagery may need network access or a previously populated cache.

| Demo | Observations | Entities | Period | Canonical Value |
|---|---:|---:|---|---|
| NOAA AIS, San Francisco Bay | 8,473 | 10 vessels | 1 January 2024 UTC | Speed over ground, knots |
| Animal GPS, Belgian herring gulls | 15,697 | 3 birds | June 2021 UTC | Ground speed, metres/second |
| Atlantic hurricanes | 3,568 | 83 storms | 2016–2025 | Maximum sustained wind, knots |

The new demos each include **Space-time tracks**, **2D tracks**, **Globe tracks** and **Bloom** saved views. Events stay visible, tracks/stems default to 25% opacity, and all observations fit the display budget. The CSVs are suitable for testing imports and the projects are ready to open without mapping fields. Use the attributes table for the original source fields, including AIS course/heading, MMSI, dimensions and navigation status, or GPS altitude, temperature, satellite count and quality flags. Blank fields stay blank; they are not zeros.

The source positions and numeric values are preserved. Chronoscope's event clock now retains seconds and fractions; reimport bundled CSVs to recover detail lost in older saved workspaces. The original seconds/milliseconds remain in CSV and event attributes (`base_date_time` / `original_timestamp`); no track interpolation or spatial aggregation is performed. Same-minute GPS fixes are retained as separate observations. These are deliberately bounded examples, not complete national AIS coverage or a complete animal study. AIS reception is incomplete and ground speed/altitude and tracking quality fields are observations, not validated ecological conclusions.

## Event and country-statistics demos

The catalog also includes global earthquakes (2025 and the January website sample), NASA FIRMS detections, country electricity access, historical COVID reference snapshots, London theft reports and the shorter hurricane workspace. See [source counts, interpretation and reproduction](PRIORITY-DEMOS.md).

## NOAA AIS

Source: [NOAA Office for Coastal Management, MarineCadastre vessel traffic](https://coast.noaa.gov/digitalcoast/data/vesseltraffic.html), [2024 archive](https://noaaocm.blob.core.windows.net/ais/csv2/csv2024/index.html). Downloaded 18 October 2026:

- Original file: `ais-2024-01-01.csv.zst` (196,492,824 bytes).
- SHA-256: `04e80b2f2896f51a7623e098eb48503b95786c9badf06550ce9e7d418654cb2d`.
- Keep every observation for ten specified MMSIs inside longitude −122.65…−122.05°, latitude 37.45…38.15°. MMSIs and exact counts are in [demo-provenance.json](../samples/public/demo-provenance.json).
- The ten vessels demonstrate passenger, pilot, tug, towing, fishing, tanker and sailing movements. This is a selected demonstration, not a random or statistically representative sample.
- NOAA public data; credit NOAA/USCG/MarineCadastre. Original AIS vessel-type and navigation-status codes remain attributes; display categories are broad labels derived from vessel-type codes. Speed is knots; course/heading are degrees; dimensions/draft are metres. Do not use this sample for navigation.

## Animal GPS

Stienen, E. W. M.; Desmet, P.; Milotic, T.; Hernandez, F.; Deneudt, K.; Matheve, H.; Bouten, W. (2022). **HG_OOSTENDE — Herring gulls (*Larus argentatus*, Laridae) breeding at the southern North Sea coast (Belgium)**, version 4. INBO. [doi:10.5281/zenodo.6594838](https://doi.org/10.5281/zenodo.6594838). Movebank study 986040562; UvA-BiTS GPS; LifeWatch infrastructure provided by VLIZ and INBO and funded by FWO. **CC0 1.0**.

- File: `HG_OOSTENDE-gps-2021.csv.gz` (6,600,756 bytes), downloaded 18 October 2026.
- Publisher MD5: `6363170757aa5f7afbe0f9f3992a9e03` (verified).
- SHA-256: `cdfb143713be31631d1262fdb6feb86e907b563265118cf44ccfef61d3a6fb53`.
- Keep every June 2021 row marked visible, excluding imported/manually flagged outliers. This yields birds H903183, H907928 and H907929, with 2,722, 6,011 and 6,964 observations. The last observation is 28 June; missing days are not filled.
- Positions are WGS84 longitude/latitude; `height-above-msl` is metres; `ground-speed` is metres/second; temperature is °C. Original source field names, quality indicators, event IDs and row numbers remain available. Units/field definitions are described in the publisher's `datapackage.json`.

## Reproduce the files

With Python 3 and the `zstandard` package, download these URLs into a temporary directory:

```text
https://noaaocm.blob.core.windows.net/ais/csv2/csv2024/ais-2024-01-01.csv.zst
https://zenodo.org/records/6594838/files/HG_OOSTENDE-gps-2021.csv.gz?download=1
```

Run `python3 scripts/prepare_real_demos.py /path/to/downloads`. The script verifies both original SHA-256 hashes before transforming data and emits deterministic CSVs, portable projects and output checksums. Large source downloads are not committed.

CLI examples:

```sh
chronoscope --attach call demo_catalog
chronoscope --attach call demo_open --args '{"id":"noaa-ais"}'
chronoscope --attach call demo_open --args '{"id":"animal-gps"}'
```

MCP tools are `chronoscope_demo_catalog` and `chronoscope_demo_open`, with the same IDs (`hurricanes`, `noaa-ais`, `animal-gps`). Opening replaces the current document, so save current work first. The bundled demos do not require filesystem access outside the configured MCP root.

## Additional wildlife

Three more ordinary datasets are available in the same picker: bobcats/fisher near Black Rock Forest, migrating white storks, and northern elephant seal dive summaries. See [Wildlife demo provenance and interpretation](WILDLIFE-DEMOS.md). They use the existing map views, tables, playback, charts and saved views. Physical depth stays an attribute; Space-time elevation continues to represent time.

## NOAA AIS 2024 rights metadata

The exact 2024 archive is linked by NOAA InPort [Nationwide Automatic Identification System 2024, item 73064](https://www.fisheries.noaa.gov/inport/item/73064/full-list). It credits U.S. Coast Guard Navigation Center / BOEM / NOAA Office for Coastal Management; access constraints: **None**; stated use constraints: **“For coastal and ocean planning.”** NOAA’s curated [Vessel Traffic catalog record](https://www.arcgis.com/sharing/rest/content/items/4a1d5c56ceb94fe2a656bf53eaece8d3?f=json) describes US-government information as public domain within the United States unless specifically annotated otherwise; foreign copyrights may apply. Identify government-sourced material and retain these qualifications rather than inferring universal rights from public download access. The sample is a selected/mapped San Francisco Bay subset, not an unmodified complete archive.
