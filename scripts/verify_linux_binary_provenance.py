#!/usr/bin/env python3
"""Replay reviewed AppImage ELF transformations and compare exact bytes.

The trusted patchelf executable is identified by explicit SHA-256. A successful
replay proves the observed local binary transforms to the packaged bytes; it
is not a source-build attestation or a license/replacement clearance.
"""
import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile

from package_linux_sources import package_metadata, sha256


def replay(original, packaged, patchelf, patch_webkit=False):
    with tempfile.TemporaryDirectory(prefix='chronoscope-replay-') as temporary:
        work = Path(temporary) / 'binary'
        shutil.copyfile(original, work)
        changes = []
        if patch_webkit:
            raw = work.read_bytes()
            count = raw.count(b'/usr')
            work.write_bytes(raw.replace(b'/usr', b'././'))
            changes.append({'operation': 'replace /usr with ././', 'occurrences': count})
        rpath = subprocess.check_output([str(patchelf), '--print-rpath', str(packaged)], text=True, stderr=subprocess.PIPE).rstrip('\n')
        subprocess.run([str(patchelf), '--set-rpath', rpath, str(work)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        changes.append({'operation': 'patchelf --set-rpath', 'value': rpath})
        return {'original_sha256': sha256(original), 'replayed_sha256': sha256(work),
                'packaged_sha256': sha256(packaged), 'exact': sha256(work) == sha256(packaged),
                'operations': changes}


def verify(inventory_file, output, patchelf, patchelf_sha256, apprun=None, gui=None):
    inventory_file = inventory_file.resolve(strict=True)
    data = json.loads(inventory_file.read_text())
    image = Path(data['appimage']).resolve(strict=True)
    if sha256(image) != data['appimage_sha256']:
        raise ValueError('AppImage changed since inventory')
    patchelf = patchelf.resolve(strict=True)
    if sha256(patchelf) != patchelf_sha256.lower():
        raise ValueError('patchelf hash mismatch')
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing existing output')
    output.mkdir(parents=True)
    root = (inventory_file.parent / 'appdir').resolve(strict=True)
    records = []
    for item in data['files']:
        if not item.get('elf'):
            continue
        rel = PurePosixPath(item['path'])
        if rel.is_absolute() or '..' in rel.parts or not rel.parts:
            raise ValueError('Unsafe inventory path')
        packaged = root / rel
        if (packaged.is_symlink() or not packaged.is_file() or
                not packaged.resolve().is_relative_to(root) or sha256(packaged) != item['sha256']):
            raise ValueError('Extracted ELF changed: ' + item['path'])
        record = {'path': item['path'], 'packaged_sha256': item['sha256'], 'status': 'unresolved'}
        if item['path'] == 'AppRun.wrapped' and apprun:
            original = apprun.resolve(strict=True)
            record.update({'source_binary': str(original), 'source_sha256': sha256(original), 'status': 'exact-tool-binary' if sha256(original) == item['sha256'] else 'unresolved'})
        elif item['path'] == 'usr/bin/chronoscope-desktop' and gui:
            original = gui.resolve(strict=True)
            result = replay(original, packaged, patchelf)
            record.update({'source_binary': str(original), 'replay': result, 'status': 'exact-replay-application-binary' if result['exact'] else 'unresolved'})
        elif item.get('exact_package_matches'):
            record.update({'status': 'exact-package-bytes', 'matches': item['exact_package_matches']})
        else:
            attempts = []
            for match in item.get('provisional_build_id_and_text_matches', []):
                candidate = Path(match['host_path'])
                try:
                    current = package_metadata(match['package']['binary'])
                    if current != match['package']:
                        continue
                    result = replay(candidate, packaged, patchelf, item['path'] == 'usr/lib/libwebkit2gtk-4.1.so.0')
                    attempts.append({'host_path': str(candidate), 'package': current, 'replay': result})
                    if result['exact']:
                        record['status'] = 'exact-replay-distro-binary'
                        break
                except (OSError, ValueError, subprocess.SubprocessError) as e:
                    attempts.append({'host_path': str(candidate), 'error': str(e)})
            record['attempts'] = attempts
        records.append(record)
    result = {'appimage_sha256': data['appimage_sha256'], 'patchelf': str(patchelf), 'patchelf_sha256': patchelf_sha256.lower(),
              'records': records, 'release_clearance': False,
              'limitations': ['Exact replay of an installed binary does not prove the source package built it.',
                 'AppRun source revision, license review, source rebuild and replacement/relinking must be resolved independently.',
                 'Inventory includes non-ELF resources that this ELF replay does not review.']}
    (output / 'binary-provenance.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inventory', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--patchelf', type=Path, required=True)
    p.add_argument('--patchelf-sha256', required=True)
    p.add_argument('--apprun', type=Path)
    p.add_argument('--built-gui', type=Path)
    a = p.parse_args()
    try:
        result = verify(a.inventory, a.output, a.patchelf, a.patchelf_sha256, a.apprun, a.built_gui)
        counts = {}
        for r in result['records']:
            counts[r['status']] = counts.get(r['status'], 0) + 1
        print(json.dumps({'counts': counts, 'output': str(a.output / 'binary-provenance.json'), 'release_clearance': False}))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print('Binary provenance verification failed: ' + str(e), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
