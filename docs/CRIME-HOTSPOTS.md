# Crime hotspots example

The heat-map gallery uses **4,053 Police.uk theft-from-the-person reports in central London, January 2025**. All returned records are retained; repeated coordinates are separate published records, not discarded duplicates. Tracks are off. Color shows approximate overlap of record counts at the chosen zoom and smoothing radius.

Open [the portable project](../samples/police-uk-london-theft-2025-01.chronoscope) directly, outside the bundled Help menu. The [CSV](../samples/public/police-uk-london-theft-2025-01.csv), [mapping](../samples/public/police-uk-london-theft-2025-01.mapping.json) and [credit companion](../samples/public/police-uk-london-theft-2025-01.csv.attribution.json) are included.

## Source and credit

[Police.uk](https://data.police.uk/), published by the Single Online Home National Digital Team with contributing police forces. [Fixed API query](https://data.police.uk/api/crimes-street/theft-from-the-person?date=2025-01&poly=51.49,-0.18:51.54,-0.18:51.54,-0.08:51.49,-0.08), retrieved 21 October 2026: category `theft-from-the-person`, month `2025-01`, rectangle 51.49–51.54°N, 0.18–0.08°W. [API documentation](https://data.police.uk/docs/method/crime-street/).

**Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).** Commercial reuse is permitted with attribution. The project embeds this credit; retain the companion with CSVs. No Police.uk logo is used and no endorsement is implied.

## Interpretation

[Police.uk publishes anonymised approximate locations and month-only dates](https://data.police.uk/about/). Source coordinates, month, category and identifiers are preserved. Nested fields are flattened; missing outcomes stay blank. `month_anchor_utc` is the first day of the published month solely for display grouping, not an incident timestamp. Exact times and addresses are not inferred.

This selected category and area show concentrations of published reports, not all crime, convictions or a population-adjusted risk score. Anonymisation, reporting and recording affect the pattern. Colors use the view’s relative maximum; smoothing changes appearance without adding observations. The local map is credited OpenFreeMap Streets / OpenMapTiles / OpenStreetMap, as in the [gallery credits](screenshots/current/README.md).

## Reproduce

Original JSON response SHA-256: `cada19d1479df0cc9385047843984ce69090f59b5be1469737fd1e518d0a4f95`.

Flattened CSV SHA-256: `d75137871bdb3da1159060a1d79b0c20e13b91e3841dc507d3cc6252ee564e3e`.

Use the fixed checked-in CSV, since a fresh API response may be revised. This imports through the real CLI, embeds provenance and the heat-map settings, then reopens the project to verify it:

```sh
python3 scripts/prepare_crime_hotspots.py --cli /absolute/path/to/chronoscope-desktop
```

The native gallery capture script loads the project through its disposable profile’s default exchange folder. The scene uses count weights, a 28-pixel smoothing radius, all 4,053 records and no tracks or stems. The camera is centered at 51.515°N, 0.13°W with an 8,500-metre map width.
