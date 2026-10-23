#!/usr/bin/env python3
"""Generate small MIT-licensed, synthetic vector-import fixtures; no downloads.

The file bytes are written independently of the Rust readers under test.
"""
from pathlib import Path
import sqlite3
import struct

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/gis/vector'
PRJ = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'


def bounds(points):
    return min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)


def shp_header(kind, length, box):
    return struct.pack('>7i', 9994, 0, 0, 0, 0, 0, length // 2) + struct.pack('<2i8d', 1000, kind, *box, 0, 0, 0, 0)


def dbf(count):
    fields = [('entity', 'C', 20, 0), ('timestamp', 'C', 24, 0), ('label', 'C', 24, 0), ('date', 'D', 8, 0), ('amount', 'N', 10, 2)]
    size = 33 + len(fields) * 32
    row_size = 1 + sum(f[2] for f in fields)
    header = bytearray(32)
    struct.pack_into('<BBBBIHH', header, 0, 3, 126, 1, 1, count, size, row_size)
    out = bytes(header)
    for name, kind, length, decimal in fields:
        field = bytearray(32)
        field[:len(name)] = name.encode()
        field[11], field[16], field[17] = ord(kind), length, decimal
        out += field
    out += b'\r'
    for i in range(count):
        values = ['sample', f'2026-01-0{i+1}T12:00:00Z', 'caf\u00e9' if i == 0 else 'second', '20260101', '12.50']
        out += b' ' + b''.join(v.encode().ljust(f[2]) for v, f in zip(values, fields))
    return out + b'\x1a'


def shapefile(name, kind, parts):
    records, all_points = [], []
    for item in parts:
        if kind == 1:
            coords = [item]
            record = struct.pack('<i2d', kind, *item)
        elif kind == 8:
            coords = item
            record = struct.pack('<i4di', kind, *bounds(coords), len(coords)) + b''.join(struct.pack('<2d', *p) for p in coords)
        else:
            coords = [p for ring in item for p in ring]
            offsets, offset = [], 0
            for ring in item:
                offsets.append(offset)
                offset += len(ring)
            record = struct.pack('<i4d2i', kind, *bounds(coords), len(item), len(coords))
            record += b''.join(struct.pack('<i', n) for n in offsets) + b''.join(struct.pack('<2d', *p) for p in coords)
        records.append(record)
        all_points += coords
    geometry, index = b'', b''
    for i, record in enumerate(records):
        index += struct.pack('>2i', (100 + len(geometry)) // 2, len(record) // 2)
        geometry += struct.pack('>2i', i + 1, len(record) // 2) + record
    base = ROOT / name
    base.with_suffix('.shp').write_bytes(shp_header(kind, 100 + len(geometry), bounds(all_points)) + geometry)
    base.with_suffix('.shx').write_bytes(shp_header(kind, 100 + len(index), bounds(all_points)) + index)
    base.with_suffix('.dbf').write_bytes(dbf(len(records)))
    base.with_suffix('.prj').write_text(PRJ + '\n')
    base.with_suffix('.cpg').write_text('UTF-8\n')


def point(x, y):
    return struct.pack('<BI2d', 1, 1, x, y)


def line(coords):
    return struct.pack('<BII', 1, 2, len(coords)) + b''.join(struct.pack('<2d', *p) for p in coords)


def polygon(rings):
    return struct.pack('<BII', 1, 3, len(rings)) + b''.join(struct.pack('<I', len(r)) + b''.join(struct.pack('<2d', *p) for p in r) for r in rings)


def gpkg(wkb):
    return b'GP\0\1' + struct.pack('<i', 4326) + wkb


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    outer = [(0, 0), (0, 4), (4, 4), (4, 0), (0, 0)]
    hole = [(1, 1), (2, 1), (2, 2), (1, 2), (1, 1)]
    second = [(10, 10), (10, 11), (11, 11), (11, 10), (10, 10)]
    shapefile('events', 1, [(12, 48), (13, 49)])
    shapefile('lines', 3, [[[(1, 1), (2, 2)]], [[(3, 3), (4, 4)], [(5, 5), (6, 6)]]])
    shapefile('zones', 5, [[outer, hole], [outer, second]])
    shapefile('clusters', 8, [[(12, 48), (13, 49)]])
    path = ROOT / 'features.gpkg'
    if path.exists():
        path.unlink()
    with sqlite3.connect(path) as conn:
        conn.executescript('''
PRAGMA application_id=1196444487;
PRAGMA user_version=10400;
CREATE TABLE gpkg_spatial_ref_sys(srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
CREATE TABLE gpkg_contents(table_name TEXT PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL, min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
CREATE TABLE gpkg_geometry_columns(table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z INTEGER NOT NULL, m INTEGER NOT NULL, PRIMARY KEY(table_name,column_name));
''')
        conn.executemany('INSERT INTO gpkg_spatial_ref_sys VALUES(?,?,?,?,?,?)', [('Undefined Cartesian', -1, 'NONE', -1, 'undefined', ''), ('Undefined geographic', 0, 'NONE', 0, 'undefined', ''), ('WGS 84', 4326, 'EPSG', 4326, PRJ, '')])
        for table, kind, geometries in [('points', 'POINT', [point(12, 48), point(13, 49), None]), ('lines', 'LINESTRING', [line([(1, 1), (2, 2)])]), ('zones', 'POLYGON', [polygon([outer, hole])])]:
            conn.execute(f'CREATE TABLE "{table}"(fid INTEGER PRIMARY KEY, entity TEXT, timestamp TEXT, label TEXT, geom BLOB)')
            conn.execute('INSERT INTO gpkg_contents VALUES(?,?,?,?,?,?,?,?,?,?)', (table, 'features', table, '', '2026-01-01T00:00:00.000Z', None, None, None, None, 4326))
            conn.execute('INSERT INTO gpkg_geometry_columns VALUES(?,?,?,?,?,?)', (table, 'geom', kind, 4326, 0, 0))
            for i, geom in enumerate(geometries):
                conn.execute(f'INSERT INTO "{table}" VALUES(?,?,?,?,?)', (9007199254740993 + i, table, f'2026-01-0{i+1}T12:00:00Z', 'synthetic', gpkg(geom) if geom else None))
    print(ROOT)


if __name__ == '__main__':
    main()
