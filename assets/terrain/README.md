# Balanced world terrain

The application-owned default is `balanced.cterrain`, a ZIP container with
independently DEFLATE-compressed 256 × 256 signed-integer-metre blocks. It remains
compressed on disk. The runtime keeps at most sixteen decoded blocks (2 MiB)
plus its existing bounded viewport meshes. No network is required at runtime.

The finest grid has 21,600 × 10,800 cell-centred samples, one arc-minute spacing
(approximately 1.9 km north–south). Seven decimated overview levels serve broad
views. Ocean-only blocks are omitted; ocean height is zero. Coastal blocks remain
and below-sea-level land is retained. Missing land elevations stay void. Built-in viewport meshes use geographic latitude rows so Globe can retain polar
relief; custom DTED retains its existing Mercator mesh registration.

Build with `python scripts/build_balanced_terrain.py SOURCE.nc4 LAND.geojson`.
Requires Python numpy, netCDF4 and rasterio. Inputs:

- USGS/NGA GMTED2010 mean, 30 arc-seconds, archived by Christopher Holmes:
  https://zenodo.org/records/14537811 (file `GMTED2010_mean_30arcsec.nc4`, published
  MD5 `5b6c47502ae8d03b8718349655d5cd95`). The builder verifies this checksum.
- Natural Earth 1:10m land polygons:
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_land.geojson
  The exact input SHA-256 is retained in the build receipt.

Heights are EGM96 orthometric metres. The archived source cells are offset about
half an arc-second west/south from the nominal grid and have a rounded pixel
size. The builder verifies their actual CF cell bounds and uses cell-overlap
weights to average valid heights onto exact one-minute cells, with periodic
longitude. Values are rounded to the nearest even integer metre. The source
ends at 83.999860415°N. All land in the supplied mask falls within its coverage;
the actual pack has no land voids. Any missing land would remain void, as tested
with synthetic fixtures. Ocean remains zero. The application adds its existing NGA EGM96 geoid
undulation for ellipsoid display. The layer is coarse visual context; spacing,
integer precision and interpolation do not establish survey accuracy.

GMTED2010 and Natural Earth data are public domain. Preserve source attribution:
https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-global-multi-resolution-terrain-elevation
https://www.naturalearthdata.com/about/terms-of-use/

`balanced.json` records the measured pack size, SHA-256 and input provenance.
`scripts/verify-balanced-terrain.mjs` checks the receipt before frontend builds;
`scripts/verify_balanced_terrain.py` additionally checks every block's CRC.
A missing pack is a packaging failure, not a downloadable first-run dependency.
The real pack is **88,778,304 bytes (84.7 MiB)**, with 2,721 stored blocks across
the finest grid and seven overviews. SHA-256:
`f93cdd806f477ebf73edb20212cd54089ea8b024cb2e4ba78e488554aa9377f8`.
The raw NetCDF and land polygons are build inputs and are not stored in Git.

`scripts/validate_balanced_source.py SOURCE.nc4 LAND.geojson` independently
checks CF-cell overlap means and polygon intersections at 1,222 target cells,
all stored and omitted overview blocks, and generates 1,950 source-backed Rust
reader probes. It additionally requires Shapely. Results and reproduction
details are in `docs/validation/balanced-terrain-2026-10-24/`.

New profiles use this layer. Older explicit terrain preferences are retained.
Terrain → Unload terrain persists; Restore bundled terrain re-enables it.
Loading user DTED replaces it and requires that source's vertical datum.
Portable workspaces reference the built-in layer by identity rather than copying
the world dataset into every workspace; user DTED remains portable as before.
