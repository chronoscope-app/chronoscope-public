# KABR UAV demo: takeoff, flight and landing

[Original KABR AirData telemetry](https://huggingface.co/datasets/imageomics/kabr_airdata), Imageomics Institute / KABR project, curated by Jenna Kline. The published dataset card declares **CC0 1.0**. The [project](https://imageomics.github.io/KABR/) describes wildlife-monitoring flights around Mpala Research Centre, Kenya, in January 2023. Original source bytes are pinned by SHA-256 in [the provenance report](../samples/public/kabr-uav-provenance.json).

The demo contains three complete logs: January 11 (6,240 records), January 12 (7,189), and January 20 (12,495). All **25,924 records** are retained, with distinct entities and one Event source layer. January 20 begins with six `0,0` GPS fixes; these are retained as unlocated records, with their original values in attributes. There are **25,918 located records**. Original filenames, logical CSV row numbers and every original field remain inspectable.

Published `datetime(utc)` seconds are used exactly, including repeated second timestamps. The finer original `time(millisecond)` counters remain attributes; no subsecond UTC precision is invented. Flight dates are not aligned or shifted, and no rows are thinned, interpolated or duplicated.

The default opens on **January 12 only**, approximately 12 minutes over a 220 × 220 m footprint. Height rises from zero to 54.8 m and returns to zero. Saved views show Time, Globe, the January 11 observation flight, the longer January 20 route (about 628 m across), and all three flights on a map. Only Time and Globe are gallery previews. Both use real Streets imagery when captured; map attribution is included.

## Height interpretation

The Globe view is explicitly a **reported height above takeoff** visualization. `height_above_takeoff(feet)` is converted to metres using exactly 0.3048 and stored as canonical `altitude` with `reference="reported"` and as Value. This is an approximate takeoff-relative display offset over the map's reference floor. It is **not** an ellipsoid altitude, terrain clearance or claim that the terrain lies at sea level. Small negative source heights are retained.

The source's `altitude_above_seaLevel(feet)` is kept verbatim and separately converted to the `reported_amsl_m` attribute. No geoid conversion, terrain-height reconstruction, or substitution between the relative and sea-level values is performed. `height_above_takeoff_m` and `altitude_basis` document the display basis. Each event's note and the fixed color legend identify it as takeoff-relative height.

Original controller-state labels include Motors Started, Assisted Takeoff, P-GPS, Go Home and landing states. These are recorded source states, not newly inferred phase boundaries.

## Reproduction

Full source logs stay outside app resources in ignored local fixtures. Run:

```sh
python3 scripts/prepare_kabr_demo.py .qa/uav-replacement-research --download
```

The script checks each original file's SHA-256 and row count, preserves published UTC ordering, and writes the portable workspace, attribution, and provenance report. Its three-file selection and 0.3048 unit conversion are deterministic. Existing local source files allow reproduction without network access.

Build the local CLI/frontend, then capture the two actual saved scenes:

```sh
CHRONOSCOPE_QA_HEADLESS=0 CHRONOSCOPE_CLI="$PWD/target/debug/chronoscope" CHRONOSCOPE_DEMO_IDS=kabr-uav node frontend/scripts/capture-demo-thumbnails.mjs
```
