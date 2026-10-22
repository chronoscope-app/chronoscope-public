# Offline shaded-relief map

**Natural Earth II with Shaded Relief and Water**, 1:50m, version 3.2.0. This idealized physical map includes land-cover colors, mountain shading and ocean bathymetry. It is artwork/reference geography, not current satellite imagery, street mapping or an elevation model.

- [Official source and download](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-2/)
- [Public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/): Natural Earth explicitly permits commercial use and modification of all versions of its raster and vector maps. Verified 2026-10-21.
- [Exact archive/member/output hashes and transformation](natural-earth-relief.json).

The upstream TIFF is downsampled to 4096 × 2048 with Lanczos and saved as JPEG quality92, without color alteration. No NASA/EOX image pixels, logos or third-party annotations are added. The compact derived map is vendored at `frontend/src/assets/earth-natural-earth.jpg`; the 85 MB upstream archive remains external.

To regenerate, download the archive URL recorded in the JSON and run:

```sh
python3 scripts/generate_commercial_fixtures.py --relief-archive /absolute/path/NE2_50M_SR_W.zip
```

The generator refuses a different archive or source hash. Running without an archive verifies the vendored map and regenerates only the synthetic test fixtures. The geographic artwork remains public domain; the generator is MIT.
