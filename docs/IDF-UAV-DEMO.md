# Retired IDF fixed-wing UAV demo

Removed from the bundled catalog on 2026-10-31: aligning 224 independent logs into a 541-second display window made the demo misleading and excessively busy. The following documents the former asset for audit and reproduction; it is no longer an app resource.

Source: [IDF_DS v1.0](https://doi.org/10.5281/zenodo.16992976), César García Gascón, with Javier Bas Bolufer, Pablo Castelló Pedrero and Juan A. Garcia-Manrique, Universitat Politècnica de València / Instituto IDF. IDF is the Instituto de Diseño para la Fabricación y Producción Automatizada.

The demo contains **399,331 original positions in 224 nonempty GPS logs** near Valencia, Spain: 103 SpeedyBee INAV logs and 121 Pixhawk PX4 logs. This is the usable processed GPS inventory, rather than a claim that all 240 flights advertised in the dataset title have distinct usable processed GPS files. Eight SpeedyBee GPS files contain headers only. `GPS/Lap068.csv` contains other telemetry and no position columns; `Lap068_gps.csv` supplies that log's five GPS fixes. The Pixhawk archive contains a nested `lap_005/lap_032` recording from log 84 and a different root `lap_032` recording from log 86. Both are retained and distinguished by log number. No position interpolation, time thinning, or reconstructed flight legs are added.

Each source log's first counter is subtracted from subsequent microsecond counters. Elapsed seconds are placed on **2000-01-01 UTC solely as a display anchor**. Flights are aligned for comparison; these are not their true UTC times or simultaneous flights. Original counter values and all original GPS columns remain Event attributes, together with the original archive path and source row. The exact per-log source counter can be recovered from those attributes. Relative playback runs from elapsed zero to approximately 541 seconds.

SpeedyBee `GPS_altitude` and Pixhawk `alt` are mapped to approximate **reported height in metres**. Vertical references remain unverified; no ellipsoid/geoid conversion is applied. Pixhawk's additional `alt_ellipsoid` remains an original attribute. Value is reported altitude in metres. A line connecting samples is a visual track, not a claim of additional measurements. Saved views provide reported Altitude, aligned Time Height, Ground Tracks, and each platform separately. The app's ordinary render budget and screen-space simplification apply while all records remain queryable.

The [Zenodo API record](https://zenodo.org/api/records/16992976) declares **CC BY 4.0**. The archive README also describes free education and research use; this demo records both statements and uses the explicit repository license. Attribution and transformation details are embedded and exported by the app, and included in packaged notices. This does not imply endorsement.

## Reproduction

Original archives: `Speedybee DataSet.zip` (580,834,225 bytes, publisher MD5 `fa6210078d8f615118027a5310dfc99c`) and `Holybro Pixhawk.zip` (2,121,943,653 bytes, publisher MD5 `8b990cc4c7ec1225a16e9a28225e5162`). The initial acquisition used ZIP byte ranges with per-member length and CRC checks; it does not claim whole-archive MD5 verification.

[The source manifest](../samples/public/idf-source-manifest.json) pins every extracted GPS/companion CSV by SHA-256, original member path, platform, and local relative filename. Place SpeedyBee files under `SOURCE/speedybee/` with their original basename. Place Pixhawk files under `SOURCE/pixhawk/` with names `<immediate-parent-lap>_<original-basename>` to distinguish recordings. Then run:

```sh
python3 scripts/prepare_idf_demo.py SOURCE
```

This reproduces `.qa/retired-demos/idf-fixed-wing-gps.demo.zip` as an ignored local audit fixture. It does not add a catalog entry, previews, or app resources. The former enlarged bundled-demo loader has been removed; external workspace limits remain unchanged. Existing user-saved SQLite copies remain ordinary editable workspaces.
