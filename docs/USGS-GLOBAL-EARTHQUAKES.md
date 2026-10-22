# Global earthquake example

The globe gallery uses **652 USGS-authored earthquakes, magnitude 4.5 or greater, January 2025 UTC**. Latitude spans −73.2204° to +81.6013° and longitude −179.8865° to +179.5566°: 341 events north of the equator and 311 south. This is worldwide catalog coverage, with uneven concentrations along plate boundaries.

Open [the portable project](../samples/usgs-global-earthquakes-2025-01.chronoscope) directly in Chronoscope. The [CSV](../samples/public/usgs-global-earthquakes-2025-01.csv), [column mapping](../samples/public/usgs-global-earthquakes-2025-01.mapping.json) and [attribution companion](../samples/public/usgs-global-earthquakes-2025-01.csv.attribution.json) are included. This additional example is opened from a file, outside the bundled Help menu.

## Source and reuse

U.S. Geological Survey, [FDSN event catalog API](https://earthquake.usgs.gov/fdsnws/event/1/). The fixed [query](https://earthquake.usgs.gov/fdsnws/event/1/query?format=csv&starttime=2025-01-01&endtime=2025-02-01&minmagnitude=4.5&eventtype=earthquake&contributor=us&orderby=time-asc) was retrieved on 21 October 2026. Of 655 returned rows, only the 652 whose `net`, `locationSource` and `magSource` all equal `us` are retained. This excludes three preferred records authored by other networks. All retained field values are unchanged; the shared entity label “Earthquakes” is an import grouping, not a moving object.

[USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) permits unrestricted reuse of USGS-authored data, which is public domain in the United States, including commercial reuse. This example uses catalog data only, without USGS logos or third-party imagery. Credit: **U.S. Geological Survey**. The project embeds this provenance; keep the companion with shared CSVs.

Original response SHA-256: `0c9ee4e358fd85f61f392e318b9e3d017903cd58ef22a662edf9162e5e1e55d6`.

Retained CSV SHA-256: `8fd920fcda60cc01f66089342e0ca5045225eec477682605a869b88dfdf7ad3d`.

## Interpretation and reproduction

Points show surface epicenters; depth remains an attribute in kilometres, not display altitude. `value` is the reported magnitude, with its original `magType` retained; magnitude types vary. Tracks and trails are off because separate earthquakes do not form a journey. The gallery centers the globe over the Pacific to show the Ring of Fire. One globe view displays one hemisphere; rotate it to explore the rest.

This is a fixed historical sample, not a live feed, complete earthquake inventory or hazard assessment. A fresh query may differ as the catalog is revised. Reproduce from the pinned checked-in CSV rather than silently replacing it with a later response:

```sh
python3 scripts/prepare_global_earthquakes.py --cli /absolute/path/to/chronoscope-desktop
```

The script imports with the real CLI, embeds provenance and the point-only globe scene, then reopens the project to check its count and settings. [Native gallery capture](screenshots/current/README.md#reproduce) loads this project through the disposable profile’s default exchange folder.
