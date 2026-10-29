# SpaceX examples and the full Starlink stress fixture

Help → Demo datasets includes **128 Starlinks · global orbits** and **700 Falcon 9 launches · 2010–2026**. Each has two rendered previews that open its exact saved scene. Both portable workspaces include dataset credit, and importable CSVs with attribution sidecars are in `samples/public/`. The former five-JAXA-rocket demo and its shipped assets have been removed.

| Example | Events | Entities / scope | Meaning of positions |
| --- | ---: | --- | --- |
| Starlink | 46,208 | 128 satellites, six hours on 26 November 2024 | Original operator-published **predicted** states, transformed to geographic coordinates and ellipsoid height |
| Falcon 9 | 700 | 700 launches, 4 June 2010–27 October 2026, three pads | Published **launch-pad locations**, with original launch times; no ascent tracks or physical altitude |
| Optional full Starlink fixture | 43,361,358 | 6,785 catalog IDs, 107-hour source slice | Every source row retained in 44 local CSV shards; separate from the bundled demos |

## Starlink source, frame assumption and selection

[MAD-LEO v1](https://doi.org/10.6084/m9.figshare.33446503.v1), Zhixin Guo et al. (2026), is licensed under **CC BY 4.0**. The operator ephemerides were originally published by SpaceX. [Paper](https://arxiv.org/abs/2609.08556), [reproducible source pipeline](https://github.com/sjtugzx/madLEO). This does not imply endorsement. The 2,051,703,305-byte `operational__starlink__ephemeris_state.parquet` contains 43,361,358 states at their original 60-second epochs, from 2024-11-26 06:00:42 UTC to 2024-11-30 16:59:42 UTC. Satellite names can be reused, so entity keys include the NORAD catalog ID.

These are **predicted ephemerides**, not measured flight telemetry and not maneuver ground truth. The source calls its inertial frame MEME but does not specify its equinox. Following the authors’ published frame-sensitivity audit, the generator assumes a **fixed J2000 mean equator/equinox**, transforms `PrecessedGeocentric(J2000)` to ITRS with Astropy and bundled IERS Earth-orientation data, then computes WGS84 geodetic latitude, longitude and ellipsoid height. This assumption remains approximate; do not use the demo for navigation, collision avoidance, or orbit-accuracy claims. No network IERS downloads occur during generation.

The demo chooses 128 evenly spaced catalog IDs from source trajectories with all 361 usable original samples in the first six hours. It retains every original minute sample in that interval, with no added interpolation, propagated samples or duplicated satellites. Heights range from about **291–596 km**. The Altitude preview colors orbital paths by satellite and hides point markers, ground tracks and stems so Earth remains visible. Derived ellipsoid height is retained as numeric `value` in kilometres and canonical `altitude_m` in metres. The opening Altitude scene selects the first 90 minutes (11,648 states) for a readable orbital view; all 46,208 states remain in the workspace. The second preview shows all six hours using Time Height. Tracks draw connections between retained samples, rather than measured continuous paths. `space-provenance.json` records exact IDs, input/output hashes, counts and coordinate controls.

The full source has **5,861 `below_surface` states** from three deorbiting objects. The small demo excludes those objects. The full stress CSVs retain every row and its quality flag, leaving altitude missing for flagged states instead of plotting predictions inside Earth. Original inertial coordinates remain available in the pinned source Parquet. Global counts include all rows; usable physical-altitude counts differ.

## Falcon 9 launch history

[Jonathan McDowell’s GCAT](https://planet4589.org/space/gcat/) is released under **CC BY 4.0**. Credit: “Jonathan McDowell, https://planet4589.org”. The pinned 27 October 2026 launch list has exactly **700 `LV_Type = Falcon 9` rows**. Five Falcon 9R development hops are excluded; failures and the 2020 Dragon in-flight abort test remain. No future launch dates are fabricated.

| Launch pad | Launches | Published latitude / longitude |
| --- | ---: | --- |
| Cape Canaveral SLC-40 | 349 | 28.5620, −80.5772 |
| Kennedy LC-39A | 114 | 28.6083, −80.6041 |
| Vandenberg SLC-4E | 237 | 34.6320, −120.6106 |

Locations come from GCAT’s launch-point table, whose stated coordinate error is 0.0001 degree for these pads. The historical `VS` and current `VSFBS` labels map to the same SLC-4E point. All original launch columns remain as attributes, including mission, vehicle variant, flight/booster ID, launch code and reported orbit parameters. Those orbit parameters are **not** assigned as vehicle altitude.

The 141 minute-only UTC times are represented as one-minute intervals, preserving their precision. Two source question-mark times retain `utc_precision=approximate`. The Time Height preview spreads the original launch dates vertically; the launch-site map uses exact count bins. Ground tracks and journey lines are disabled, so successive launches do not imply a vehicle traveling between pads.

The older Falcon webcast archive has dense altitude/speed samples for 35 launches but lacks measured latitude/longitude. It was not used to invent ascent trajectories. The 700-launch catalog supplies the requested broader site/date history instead.

## Reproduction

Download these three pinned inputs once to a local source directory:

```sh
curl -fL https://ndownloader.figshare.com/files/68257597 -o INPUT/operational__starlink__ephemeris_state.parquet
curl -fL https://planet4589.org/space/gcat/tsv/launch/launch.tsv -o INPUT/launch.tsv
curl -fL https://planet4589.org/space/gcat/tsv/tables/lp.tsv -o INPUT/lp.tsv
```

There are three data inputs; the Figshare article metadata and its `docs__metadata.md` are useful accompanying references. The generator verifies exact SHA-256 hashes before use, so later upstream changes require an explicit review. Required generation libraries: Python 3, NumPy, PyArrow, Astropy and astropy-iers-data. The checked generation used PyArrow 24.0.0 and Astropy 8.0.2; no astronomy library is added to the app runtime.

```sh
python3 scripts/prepare_space_demos.py INPUT
# Optional full export: new directory, ~4.28 GB of CSV plus the 2.05 GB source.
python3 scripts/prepare_space_demos.py INPUT --stress-output .qa/starlink-full-stress
# Verify/finalize existing exported shards without rewriting them:
python3 scripts/prepare_space_demos.py INPUT --reuse-stress .qa/starlink-full-stress
```

## Local scale checks

The full fixture is not shipped inside the app or committed to Git. `scripts/starlink_stress.py` inspects it by default, or loads an explicit tier through the real persistent CLI, verifies exact query counts, requests a bounded render packet, and saves a credit-preserving portable workspace. The output directory must be new. It checks free disk before creating indexed/staging copies and keeps a reserve; do not assume the 4.28 GB CSV size equals the indexed workspace’s storage cost.

```sh
python3 scripts/starlink_stress.py --fixture .qa/starlink-full-stress
python3 scripts/guarded_run.py -- python3 scripts/starlink_stress.py --rows 100000 --output .qa/starlink-stress-100k
python3 scripts/guarded_run.py -- python3 scripts/starlink_stress.py --rows 1000000 --output .qa/starlink-stress-1m
# Full ingest is optional and requires substantially more free disk:
python3 scripts/guarded_run.py -- python3 scripts/starlink_stress.py --rows 43361358 --output .qa/starlink-stress-full
```

The bundled Starlink workspace, both previews and associated credit metadata must together be **at most 5,000,000 bytes**; a regression check enforces this. The large source Parquet, full stress CSVs and test workspaces are excluded from app resources. The CSV subset in the source repository is an optional export, not an app resource.

The app supports at most 50 million Events per workspace and bounds the normal marker packet to **100,000 representative points**. Exact backend counts and complete imported records do not imply that all 43 million states are drawn at once. Scale receipts must distinguish source conversion, indexed ingestion, exact queries, representative rendering and measured frame performance. These fixtures do not by themselves establish a rendering-speed improvement.
