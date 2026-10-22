# Wildlife demo datasets

Open **Help → Demo datasets**, then choose one of these ordinary editable workspaces. Matching CSVs are under `samples/public/`; portable projects are under `samples/`. Each has the existing Space-time, 2D, Globe and Bloom saved views. These examples introduce no story interface, exploration mode or physical depth view. Normal startup stays empty.

| Demo ID | Records | Animals | Observation period | Canonical Value |
|---|---:|---:|---|---|
| `local-wildlife` | 3,439 | 2 bobcats, 1 fisher | 1–7 March 2023 UTC | Ground speed, m/s |
| `stork-migration` | 6,090 | 3 white storks | 30 July–29 September 2018 UTC | Empty; source has no speed measurement |
| `elephant-seals` | 15,501 | 3 adult female northern elephant seals | 22 February–3 June 2004 UTC | Maximum depth during each dive, m |

## Bobcats and fisher — local movements

**LaPoint, Scott (2026). Data from: Study “Carnivore movements near Black Rock Forest New York” [part]. Movebank Data Repository. https://doi.org/10.5441/001/1.652.** Hudson Highlands Wildlife Connectivity Project. Licensed **Creative Commons Attribution 4.0 International**, https://creativecommons.org/licenses/by/4.0/.

Changes made for this demonstration: select visible, located observations without imported/manually marked outlier flags, for individuals LYRU_0003 and LYRU_0004 (bobcats, *Lynx rufus*) and PEPE_0001 (fisher, *Pekania pennanti*), from 1 March inclusive to 8 March exclusive. Retain every qualifying observation, including original source fields and event IDs. Add canonical import columns and human-readable species labels. No positions or speeds are interpolated. Original second-resolution timestamps remain in `original_timestamp`; Chronoscope now retains seconds and fractions when importing this CSV; older saved workspaces need reimport to recover previously discarded detail. Category names are readable equivalents of the retained taxonomic field.

The 32,960,972-byte source CSV was downloaded on 18 October 2026 from the original file linked by the repository's public API. Its publisher MD5 is `cfb0ae343499aa992d7f3773555c9c58` (verified); SHA-256 is `5700142e5702cbf6680e5ee1cc0a3dce78980ffb67c9bc4f6c80b366a844d60e`. This subset is not the entire study or a representative sample of the species.

## White storks — migration

**Fiedler W, Flack A, Schäfle W, Keeves B, Quetting M, Eid B, Schmid H, Wikelski M (2019). Data from: Study “LifeTrack White Stork SW Germany” (2013–2019). Movebank Data Repository. https://doi.org/10.5441/001/1.ck04mn78. CC0 1.0.** Related paper: Cheng Y, Fiedler W, Wikelski M, Flack A (2019), *“Closer-to-home” strategy benefits juvenile survival in a long-distance migratory bird*, https://doi.org/10.1002/ece3.5395.

Source: the CC0 `whitestork_data.rda` example distributed by [moveVis](https://movevis.org/reference/whitestork_data.html), authored by Jakob Schwalb-Willmann and Annika Ludwig. The plain `df` contains original longitude, latitude, timestamp, identifier and name columns. Download: https://raw.githubusercontent.com/16EAGLE/moveVis/master/data/whitestork_data.rda. SHA-256 `930afdea6d079f6a3305e49bb84c15f10a7215ccadebdab718b1f7c6449b5cca`.

Changes: select Mirabell, Linus B and Wendelin, and retain the first original observation in each fixed UTC 30-minute bucket for each bird. This reduces repeated stationary fixes while retaining measured positions; it is thinning, not interpolation or aggregation. Preserve the R table's original row index, individual identifier and Unix timestamp in attributes. Canonical Value is empty because this source does not contain speed. Tracks show these individuals' observed journeys through Europe and into North Africa, rather than the species' full migration range.

## Elephant seals — ocean tracks and dive attributes

**Costa, Daniel; Holser, Rachel; Keates, Theresa; et al. Northern elephant seal tracking and diving — processed data. Dryad, https://doi.org/10.7291/D18D7W, version published 15 May 2025. CC0 1.0.** Data descriptor: Costa et al. (2024), *Two decades of three-dimensional movement data from adult female northern elephant seals*, https://doi.org/10.1038/s41597-024-04084-4.

The publisher's `2004_Processed.zip` (27,923,418 bytes) has SHA-256 `6f82ea93d64c574b183c150136f7e1060f64e2159f54c450bb594b34b33ce460` (verified against Dryad API metadata). Download it from the current version's public file list: https://datadryad.org/downloads/file_stream/4072218.

Changes: retain all 15,501 primary-instrument `TDR1` dive summaries in deployments 2004001 (R881), 2004004 (99AB), and 2004005 (O176). Omit alternate 8-second/secondary instrument groups so the same dives are not duplicated. Preserve each original summary variable and source file/group/index. Locations are the publisher's processed/modelled **dive-start** coordinates; no new location interpolation is done here. One event represents a dive, not a continuously measured underwater GPS position. End time is derived from start plus the published `DURATION` in seconds. The existing bundled workspace was authored with minute-aligned Event times/end times; original `DATE`, `DURATION` and derived second-resolution `end_timestamp` remain attributes.

**Value / MAXDEPTH is maximum depth during that dive, in metres below the sea surface.** It is not depth at dive start and is not used as map elevation. `LAT`/`LON` describe the dive start, while MAXDEPTH can occur later elsewhere. Space-time's vertical axis still shows time. The ordinary Charts tab includes a saved **Daily deepest dive (m)** preset, grouped by animal, using the daily maximum of the dive maxima. Tables, field profiles and existing statistical analysis can examine depth, duration and other attributes.

Source quality note: in these published files, `LAT_SE_KM` and `LON_SE_KM` repeat coordinate values and do not appear to represent usable position-error estimates. They are retained unchanged as source fields and are not used to construct uncertainty or confidence displays. The source's other analysis/quality fields are likewise retained rather than silently corrected. These three adult females are a selected example, not a representative sample of all seals.

## Reproduce and verify

Install Python readers `rdata` and `netCDF4`. Place `carnivores.csv`, `whitestork_data.rda`, and `2004_Processed.zip` in a temporary input directory, then run:

```sh
python3 scripts/prepare_wildlife_demos.py /path/to/downloads
```

Obtain `carnivores.csv` from the dataset's original-file link (the source filename is “Carnivore movements near Black Rock Forest New York_part.csv”). The script verifies original SHA-256 digests before converting and emits deterministic CSVs/projects plus [wildlife-provenance.json](../samples/public/wildlife-provenance.json), including output digests, exact selection rules and dates. Large upstream files and Python readers are build-time inputs only and are not bundled into the app.

Existing CLI/MCP access:

```sh
chronoscope --attach call demo_open --args '{"id":"local-wildlife"}'
chronoscope --attach call demo_open --args '{"id":"stork-migration"}'
chronoscope --attach call demo_open --args '{"id":"elephant-seals"}'
```

The same IDs work with `chronoscope_demo_open`; `chronoscope_demo_catalog` lists all bundled examples. Opening a demo replaces the current workspace, and Save creates your own copy.


Existing bundled `.chronoscope` examples were authored with the earlier minute-resolution clock. To explore their full source timing now, open the corresponding `samples/public/*.csv` through import. The demo preparation scripts preserve fractional timestamps in newly generated bundles. Previously lost detail is never guessed from a saved minute-only Event.
