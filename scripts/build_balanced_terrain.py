#!/usr/bin/env python3
"""Build offline Balanced terrain; no runtime downloads or unpacked disk cache.

Inputs: GMTED2010_mean_30arcsec.nc4 from Zenodo record 14537811 and
Natural Earth ne_10m_land.geojson. Requires numpy, netCDF4 and rasterio.
The source checksum and coordinate registration are verified before resampling.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import numpy as np

SOURCE_MD5 = "5b6c47502ae8d03b8718349655d5cd95"
NODATA = -32767
TILE = 256


def overlaps(edges, start, step, count, periodic=False):
    """Source indices and exact linear cell-overlap weights for target cells."""
    first = np.floor((edges[:-1] - start) / step).astype(int)
    result = []
    for offset in range(4):  # a 60-second cell intersects at most 4 30-second cells
        index = first + offset
        if periodic:
            lower = start + (index % count) * step + (index // count) * 360
            valid = np.ones_like(index, dtype=bool)
        else:
            lower = start + index * step
            valid = (index >= 0) & (index < count)
        weight = np.maximum(0, np.minimum(edges[1:], lower + step)
                            - np.maximum(edges[:-1], lower)) / np.diff(edges)
        result.append((index % count, weight * valid))
    return result


def resample(variable, lat_bounds, lon_bounds):
    """Conservative means on the exact target grid, excluding source voids.

    The archived ArcGrid has a half-arc-second west/south offset and a rounded
    pixel size. Treating it as aligned 2x2 cells moves the terrain. Use its CF
    cell bounds, including periodic longitude and partial coverage at 84 N.
    """
    grid = np.full((10800, 21600), NODATA, dtype="<i2")
    horizontal = overlaps(np.linspace(-180, 180, 21601), lon_bounds[0, 0],
                          lon_bounds[0, 1] - lon_bounds[0, 0], len(lon_bounds), True)
    vertical = overlaps(np.linspace(-90, 90, 10801), lat_bounds[0, 0],
                        lat_bounds[0, 1] - lat_bounds[0, 0], len(lat_bounds))
    # A source chunk spans 1,160 rows; retain one full latitude strip so row
    # reads do not repeatedly decompress the same 33 longitude chunks.
    variable.set_var_chunk_cache(256 * 1024 * 1024, 1009, 0.75)
    for row in range(10800):
        total = np.zeros(21600, dtype=np.float64)
        weights = np.zeros(21600, dtype=np.float64)
        for indices, latitude_weights in vertical:
            wy = latitude_weights[row]
            if wy == 0:
                continue
            source = np.ma.asarray(variable[int(indices[row]), :], dtype=np.float64)
            valid = ~np.ma.getmaskarray(source)
            heights = source.filled(0)
            if not np.isfinite(heights).all():
                raise ValueError("Nonfinite source heights")
            for columns, wx in horizontal:
                weight = wy * wx * valid[columns]
                total += heights[columns] * weight
                weights += weight
        covered = weights > 0
        values = np.rint(total[covered] / weights[covered])
        if np.any((values <= NODATA) | (values > 32767)):
            raise ValueError("Source height exceeds signed metre encoding")
        grid[row, covered] = values.astype("<i2")
        if row % 1000 == 0:
            print(f"Resampled {row}/10800 rows", flush=True)
    return grid


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_pack(grid, output, provenance):
    """Cell centres, south-to-north rows; omitted blocks mean ocean at zero.

    Every block is independently DEFLATE compressed after reversible horizontal
    integer differencing. Signed metre heights and land voids remain lossless.
    """
    output.parent.mkdir(parents=True, exist_ok=True)
    levels = []
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED,
                         compresslevel=9, allowZip64=False) as archive:
        level = 0
        while True:
            height, width = grid.shape
            tiles = []
            for y in range(0, height, TILE):
                for x in range(0, width, TILE):
                    block = grid[y:y + TILE, x:x + TILE].astype("<i2")
                    if not np.any(block):
                        continue
                    delta = block.copy()
                    delta[:, 1:] = block[:, 1:] - block[:, :-1]
                    name = f"{level}/{y // TILE}/{x // TILE}.bin"
                    info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    archive.writestr(info, delta.tobytes(), compresslevel=9)
                    tiles.append([x // TILE, y // TILE])
            levels.append(dict(width=width, height=height, tiles=tiles))
            print(f"Compressed level {level}: {width} x {height}, {len(tiles)} blocks", flush=True)
            if width <= TILE and height <= TILE:
                break
            # Decimation retains exact original samples, including voids. Only
            # the finest level is the advertised 1-minute terrain product.
            grid = grid[::2, ::2]
            level += 1
        manifest = dict(format=1, name="Balanced world terrain", source="USGS GMTED2010",
                        datum="egm96", spacing_arc_seconds=60, tile_size=TILE,
                        width=21600, height=10800, levels=levels,
                        attribution="USGS/NGA GMTED2010 · Natural Earth land mask · public domain",
                        provenance=provenance)
        info = zipfile.ZipInfo("manifest.json", (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(info, json.dumps(manifest, sort_keys=True, separators=(",", ":")), compresslevel=9)
    return dict(bytes=output.stat().st_size, sha256=digest(output),
                levels=len(levels), tiles=sum(len(l["tiles"]) for l in levels))


def main():
    from netCDF4 import Dataset
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("land", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "assets/terrain/balanced.cterrain")
    args = parser.parse_args()
    if digest(args.source, "md5") != SOURCE_MD5:
        parser.error("Source does not match the published Zenodo GMTED2010 mean checksum")
    land = json.loads(args.land.read_text())
    # Include coastal cells touched by land; never use height > 0 as a land mask
    # (that would discard the Dead Sea and other below-sea-level terrain).
    mask = rasterize(((f["geometry"], 1) for f in land["features"]),
                     out_shape=(10800, 21600), transform=from_origin(-180, 90, 1 / 60, 1 / 60),
                     all_touched=True, dtype="uint8")[::-1]
    with Dataset(args.source) as ds:
        lat = np.asarray(ds.variables["lat"][:])
        lon = np.asarray(ds.variables["lon"][:])
        variable = ds.variables["surface_altitude"]
        if len(lon) != 43200 or len(lat) != 20880 or variable.shape != (len(lat), len(lon)):
            parser.error("Unexpected source dimensions")
        if variable.units != "m" or "EGM96" not in variable.long_name:
            parser.error("Expected source heights in EGM96 metres")
        bounds = []
        for name, coordinates, origin in [("lat", lat, -90), ("lon", lon, -180)]:
            cells = np.asarray(ds.variables[name + "_bnds"][:])
            step = 0.008333333300000011
            expected = origin - 1 / 7200 + np.arange(len(coordinates) + 1) * step
            if (not np.allclose(cells[:, 0], expected[:-1], atol=1e-9, rtol=0)
                    or not np.allclose(cells[:, 1], expected[1:], atol=1e-9, rtol=0)
                    or not np.allclose(coordinates, cells.mean(axis=1), atol=1e-9, rtol=0)):
                parser.error(f"Unexpected source {name} cell registration")
            bounds.append(cells)
        lat_bounds, lon_bounds = bounds
        grid = resample(variable, lat_bounds, lon_bounds)
    grid[mask == 0] = 0
    provenance = dict(source_url="https://zenodo.org/records/14537811",
                      source_md5=SOURCE_MD5, source_sha256=digest(args.source),
                      land_sha256=digest(args.land),
                      source_bounds=[float(lon_bounds[0, 0]), float(lat_bounds[0, 0]),
                                     float(lon_bounds[-1, 1]), float(lat_bounds[-1, 1])],
                      source_dimensions=[43200, 20880],
                      resampling="Cell-overlap-weighted mean of valid source cells; periodic longitude; nearest even integer metre",
                      registration="Cell centres, south-to-north; 1 arc-minute",
                      voids="Missing source land stays void; masked ocean is zero; no bathymetry")
    result = write_pack(grid, args.output, provenance)
    args.output.with_suffix(".json").write_text(json.dumps({**result, **provenance}, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
