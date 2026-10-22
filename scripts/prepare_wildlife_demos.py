#!/usr/bin/env python3
"""Convert licensed, fixed wildlife sources into ordinary CSVs and saved projects.

See docs/WILDLIFE-DEMOS.md for downloads and Python reader dependencies.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import tempfile
import warnings
import zipfile
from prepare_real_demos import ROOT, verified, write_demo

CARNIVORE_SHA = '5700142e5702cbf6680e5ee1cc0a3dce78980ffb67c9bc4f6c80b366a844d60e'
STORK_SHA = '930afdea6d079f6a3305e49bb84c15f10a7215ccadebdab718b1f7c6449b5cca'
SEAL_SHA = '6f82ea93d64c574b183c150136f7e1060f64e2159f54c450bb594b34b33ce460'
CARNIVORE_IDS = {'LYRU_0003', 'LYRU_0004', 'PEPE_0001'}
STORK_NAMES = {'Mirabell', 'Linus B', 'Wendelin'}
SEAL_FILES = ['2004001_TrackTDR_Processed.nc', '2004004_TrackTDR_Processed.nc',
              '2004005_TrackTDR_Processed.nc']


def iso(t):
    return t.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def utc(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00')).replace(tzinfo=dt.timezone.utc)


def padded_bounds(rows):
    lon = [float(r['longitude']) for r in rows]
    lat = [float(r['latitude']) for r in rows]
    dx = max(.01, (max(lon)-min(lon))*.06)
    dy = max(.01, (max(lat)-min(lat))*.06)
    return [min(lon)-dx, min(lat)-dy, max(lon)+dx, max(lat)+dy]


def carnivores(folder):
    verified(folder/'carnivores.csv', CARNIVORE_SHA)
    rows = []
    for n, r in enumerate(csv.DictReader((folder/'carnivores.csv').open()), 2):
        if not (r['individual-local-identifier'] in CARNIVORE_IDS and
                '2023-03-01' <= r['timestamp'] < '2023-03-08' and r['visible'] == 'true' and
                r['import-marked-outlier'] != 'true' and r['manually-marked-outlier'] != 'true'):
            continue
        if not r['location-lat'] or not r['location-long']:
            continue
        species = {'Lynx rufus': 'Bobcat', 'Pekania pennanti': 'Fisher'}[r['individual-taxon-canonical-name']]
        original_time = r.pop('timestamp')
        rows.append(dict(entity=r['individual-local-identifier'], category=species,
                         label=species+' '+r['individual-local-identifier'],
                         timestamp=iso(utc(original_time)), latitude=r['location-lat'],
                         longitude=r['location-long'], value=r['ground-speed'], value_unit='m/s',
                         original_timestamp=original_time, source_row=str(n), **r))
    return write_demo('animal-gps-black-rock-forest-2023-03', 'Bobcats and fisher · Black Rock Forest · March 2023',
                      rows, padded_bounds(rows), 'https://doi.org/10.5441/001/1.652', CARNIVORE_SHA,
                      dict(individuals=sorted(CARNIVORE_IDS), start='2023-03-01T00:00:00Z', end_exclusive='2023-03-08T00:00:00Z',
                           license='CC BY 4.0', rule='All visible, unflagged, located observations in this week; no thinning.'),
                      provenance=[{'title': 'Hudson Highlands Wildlife Connectivity Project — Black Rock Forest, March 2023 subset', 'creator': 'Scott LaPoint (2026)', 'source_url': 'https://doi.org/10.5441/001/1.652', 'license': 'CC BY 4.0', 'license_url': 'https://creativecommons.org/licenses/by/4.0/', 'changes': 'Selected LYRU_0003, LYRU_0004 and PEPE_0001, 1–7 March 2023; visible, unflagged, located observations only; no thinning or interpolation. Columns mapped to Chronoscope Events; original timestamps and source attributes retained.'}])


def storks(folder):
    import rdata
    verified(folder/'whitestork_data.rda', STORK_SHA)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', UserWarning)
        # The plain df is the original package table; do not infer coordinates
        # from the reader's unsupported sf/move2 class conversion.
        table = rdata.read_rda(folder/'whitestork_data.rda')['df']
    rows = []
    seen = set()
    table = table.sort_values(['timestamp', 'name'], kind='stable')
    for index, r in table.iterrows():
        if r['name'] not in STORK_NAMES:
            continue
        epoch = float(r['timestamp'])
        key = (str(r['name']), int(epoch)//1800)
        if key in seen:
            continue
        seen.add(key)
        rows.append(dict(entity=str(r['name']), category='White stork', label='White stork · '+str(r['name']),
                         timestamp=iso(dt.datetime.fromtimestamp(epoch,dt.timezone.utc)),
                         latitude=str(r['location-lat']), longitude=str(r['location-long']), value='',
                         source_row=str(int(index)), source_index=str(int(index)),
                         original_timestamp_unix_s=str(epoch),
                         **{str(k):str(v) for k,v in r.items() if k != 'timestamp'}))
    return write_demo('animal-gps-white-storks-2018', 'White storks · Europe to Africa · 2018',
                      rows, padded_bounds(rows), 'https://doi.org/10.5441/001/1.ck04mn78', STORK_SHA,
                      dict(individuals=sorted(STORK_NAMES), license='CC0 1.0',
                           rule='First original observation per individual per fixed UTC 30-minute bucket, from the moveVis example subset; no interpolation.'))


def seals(folder):
    import numpy as np
    from netCDF4 import Dataset
    verified(folder/'2004_Processed.zip', SEAL_SHA)
    rows = []
    excluded = collections.Counter()
    with zipfile.ZipFile(folder/'2004_Processed.zip') as archive, tempfile.TemporaryDirectory() as temp:
        for file in SEAL_FILES:
            archive.extract(file,temp)
            with Dataset(Path(temp)/file) as dataset:
                group = dataset.groups['TDR1']
                arrays = {k:v[:] for k,v in group.variables.items()}
                animal = str(dataset.getncattr('Animal_ID'))
                deployment = str(int(dataset.getncattr('Deployment_ID')))
                for i in range(len(arrays['DATE'])):
                    raw = {}
                    for k,a in arrays.items():
                        v = a[i]
                        raw[k] = '' if np.ma.is_masked(v) or isinstance(v,(float,np.floating)) and not math.isfinite(v) else str(v)
                    if not all(raw[k] for k in ['DATE','LAT','LON','MAXDEPTH','DURATION']):
                        excluded[file]+=1
                        continue
                    lat,lon,depth,duration = [float(raw[k]) for k in ['LAT','LON','MAXDEPTH','DURATION']]
                    if not (-90<=lat<=90 and -180<=lon<=180 and depth>=0 and duration>=0):
                        excluded[file]+=1
                        continue
                    start = dt.datetime.strptime(raw['DATE'],'%d-%b-%Y %H:%M:%S').replace(tzinfo=dt.timezone.utc)
                    # One point per published dive summary, located at its modelled
                    # dive-start position. MAXDEPTH is a summary, not height here.
                    rows.append(dict(entity=animal, category='Northern elephant seal',
                                     label='Seal '+animal+' · dive '+str(i+1), timestamp=iso(start),
                                     end_timestamp=iso(start+dt.timedelta(seconds=duration)),
                                     latitude=raw['LAT'],longitude=raw['LON'],value=raw['MAXDEPTH'],value_unit='m',
                                     value_description='Maximum depth during dive; positive below sea surface',
                                     position_method='Published processed/modelled location at dive start',
                                     source_row=str(i+1),source_file=file,source_group='TDR1',
                                     animal_id=animal,deployment_id=deployment,**raw))
    return write_demo('animal-telemetry-elephant-seals-2004', 'Elephant seals · North Pacific dives · 2004',
                      rows,padded_bounds(rows),'https://doi.org/10.7291/D18D7W',SEAL_SHA,
                      dict(files=SEAL_FILES,group='TDR1',license='CC0 1.0',excluded_rows=dict(excluded),
                           rule='All finite, located primary-instrument dive summaries for three deployments; alternate 8-second and secondary instruments excluded to avoid duplicates.'),
                      chart_preset=dict(name='Daily deepest dive (m)', config=dict(kind='line',scope='visible',
                                        x='time',x_axis='time',y='value',group='entity',aggregate='max',time_bucket='day')))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_dir',type=Path)
    args=parser.parse_args()
    report=[carnivores(args.input_dir),storks(args.input_dir),seals(args.input_dir)]
    (ROOT/'samples/public/wildlife-provenance.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
