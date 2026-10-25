#!/usr/bin/env python3
"""Independently compare the real pack to CF source cells and land geometry.

Requires the builder dependencies plus shapely. Does not import the producer.
Writes source-backed Rust regression probes and a measured validation report.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import numpy as np
from netCDF4 import Dataset
from shapely.geometry import box, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('land', type=Path)
    parser.add_argument('--pack', type=Path, default=ROOT/'assets/terrain/balanced.cterrain')
    parser.add_argument('--output', type=Path, default=ROOT/'docs/validation/balanced-terrain-2026-10-24/source-checks.json')
    args = parser.parse_args()
    trees = STRtree([shape(f['geometry']) for f in json.loads(args.land.read_text())['features']])
    probes = []
    names = [
        ('Everest', 27.9881, 86.9250), ('Denali', 63.0695, -151.0074),
        ('Andes', -32.6532, -70.0109), ('Alps', 45.8326, 6.8652),
        ('Dead Sea', 31.5, 35.4), ('Death Valley', 36.25, -116.825),
        ('Caspian coast', 46.3, 49.5), ('Netherlands', 52.0, 4.5),
        ('Hamilton coast', 43.25, -79.8), ('Antarctic interior', -89.9, 0),
        ('Antarctic coast', -77.85, 166.67), ('Greenland', 80, -40),
        ('Arctic source limit', 83.99, -35), ('Arctic ocean beyond source', 84.5, -35),
        ('North Pole ocean', 89.99, 0), ('South Pole', -89.999, 0),
        ('Dateline east', -16.5, 179.999), ('Dateline west', -16.5, -179.999),
        ('Aleutian east', 51.8, 179.9), ('Aleutian west', 51.8, -179.9),
        ('Pacific ocean', 0, -140), ('Atlantic ocean', 0, -30),
    ]
    cells = {(int((lat+90)*60), int((lon+180)*60)): name for name, lat, lon in names}
    rng = np.random.default_rng(20261024)
    for _ in range(1200):
        cells.setdefault((int(rng.integers(10800)), int(rng.integers(21600))), 'global random')
    with zipfile.ZipFile(args.pack) as archive, Dataset(args.source) as source:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['provenance']['source_sha256'] == sha256(args.source)
        assert manifest['provenance']['land_sha256'] == sha256(args.land)
        finest = np.zeros((10800, 21600), dtype='<i2')
        levels = []
        for level, info in enumerate(manifest['levels']):
            count = 0
            for x, y in info['tiles']:
                width = min(256, info['width']-x*256)
                height = min(256, info['height']-y*256)
                raw = archive.read(f'{level}/{y}/{x}.bin')
                block = np.frombuffer(raw, dtype='<i2').reshape(height, width)
                block = block.cumsum(axis=1, dtype=np.int32).astype('<i2')
                assert block.any(), 'All-zero blocks must be omitted'
                if level == 0:
                    finest[y*256:y*256+height, x*256:x*256+width] = block
                else:
                    scale = 2**level
                    expected = finest[y*256*scale:(y*256+height)*scale:scale,
                                      x*256*scale:(x*256+width)*scale:scale]
                    np.testing.assert_array_equal(block, expected)
                count += 1
            if level > 0:
                # Also check omitted blocks, so missing nonzero overviews fail.
                overview = finest[::2**level, ::2**level]
                present = {tuple(tile) for tile in info['tiles']}
                for y in range(0, info['height'], 256):
                    for x in range(0, info['width'], 256):
                        assert bool(overview[y:y+256, x:x+256].any()) == ((x//256, y//256) in present)
            levels.append(dict(level=level, width=info['width'], height=info['height'], stored_blocks=count,
                               omitted_blocks=((info['width']+255)//256)*((info['height']+255)//256)-count))
        lat_bounds = np.asarray(source['lat_bnds'][:])
        lon_bounds = np.asarray(source['lon_bnds'][:])
        variable = source['surface_altitude']
        variable.set_var_chunk_cache(256*1024*1024, 1009, .75)
        comparisons = []
        for (y, x), name in sorted(cells.items()):
            west, south = -180+x/60, -90+y/60
            east, north = west+1/60, south+1/60
            land = len(trees.query(box(west, south, east, north), predicate='intersects')) > 0
            # Work directly with CF boundary arrays, not the producer's index
            # formula. Periodic copies of the original cells retain exact edges.
            ys = np.flatnonzero((lat_bounds[:, 0] < north) & (lat_bounds[:, 1] > south))
            total = weight = 0.
            if land:
                for shift in (-360, 0, 360):
                    xs = np.flatnonzero((lon_bounds[:, 0]+shift < east) & (lon_bounds[:, 1]+shift > west))
                    if not len(xs) or not len(ys):
                        continue
                    heights = variable[ys, xs]
                    for iy, sy in enumerate(ys):
                        for ix, sx in enumerate(xs):
                            if np.ma.is_masked(heights[iy, ix]):
                                continue
                            dy = min(north, lat_bounds[sy, 1])-max(south, lat_bounds[sy, 0])
                            dx = min(east, lon_bounds[sx, 1]+shift)-max(west, lon_bounds[sx, 0]+shift)
                            total += float(heights[iy, ix])*dx*dy
                            weight += dx*dy
            expected = int(np.rint(total/weight)) if weight else (-32767 if land else 0)
            actual = int(finest[y, x])
            assert actual == expected, (name, x, y, actual, expected)
            probe = dict(name=name, level=0, latitude=south+1/120, longitude=west+1/120,
                         expected=None if expected == -32767 else expected)
            probes.append(probe)
            if name != 'global random':
                comparisons.append({**probe, 'land_cell':land, 'valid_source_overlap':weight*3600})
        # Exercise the Rust reader at every overview's retained sample centres,
        # including its noninteger periodic seam on the last two levels.
        for level, info in enumerate(manifest['levels'][1:], 1):
            scale = 2**level
            points = [(0,0), (info['width']-1,info['height']-1), (0,info['height']//2),
                      (info['width']-1,info['height']//2)]
            points += [(int(rng.integers(info['width'])), int(rng.integers(info['height']))) for _ in range(100)]
            for x, y in points:
                height = int(finest[y*scale, x*scale])
                probes.append(dict(name='overview registration', level=level,
                                   latitude=-90+(y*scale+.5)/60, longitude=-180+(x*scale+.5)/60,
                                   expected=None if height == -32767 else height))
        report = dict(pack_sha256=sha256(args.pack), source_sha256=sha256(args.source),
                      land_sha256=sha256(args.land), independent_source_cells=len(cells),
                      all_stored_overview_samples_match_finest=True, levels=levels,
                      finest_void_cells=int(np.count_nonzero(finest == -32767)),
                      finest_negative_land_cells=int(np.count_nonzero((finest < 0) & (finest != -32767))),
                      finest_minimum=int(finest[finest != -32767].min()), finest_maximum=int(finest.max()),
                      named_comparisons=comparisons, rust_probes=probes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2)+'\n')
    print(f'Validated {len(cells)} independent source cells, all overview blocks, {len(probes)} Rust probes: {args.output}')


if __name__ == '__main__':
    main()
