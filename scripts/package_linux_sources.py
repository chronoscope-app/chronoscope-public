#!/usr/bin/env python3
"""Inventory an exact Linux AppImage and download matched distro source packages.

This tool does not certify source/relinking compliance. It records unmatched or
modified files for human review and always leaves release_clearance false.
Extraction uses unsquashfs, never executes the AppImage, and writes only to a
new output directory. Source downloads use a private authenticated apt index.
"""
import argparse
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import stat
import shutil
import struct
import subprocess
import sys
import tarfile

CHUNK = 1024 * 1024
MAX_IMAGE = 2 * 1024 ** 3
MAX_FILES = 100000
MAX_UNPACKED = 8 * 1024 ** 3


def sha256(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def image_offset(path):
    """Find type-2 AppImage squashfs at the end of its ELF section table."""
    with path.open('rb') as f:
        header = f.read(64)
        if len(header) != 64 or header[:6] != b'\x7fELF\x02\x01' or header[8:11] != b'AI\x02':
            raise ValueError('Expected a little-endian ELF64 type-2 AppImage')
        values = struct.unpack('<16sHHIQQQIHHHHHH', header)
        offset = values[6] + values[11] * values[12]
        if offset < 64 or offset >= path.stat().st_size:
            raise ValueError('Invalid ELF section table boundary')
        f.seek(offset)
        if f.read(4) != b'hsqs':
            raise ValueError('Squashfs not at ELF boundary; refusing to guess')
        return offset


def package_index(info_dir=Path('/var/lib/dpkg/info')):
    index = {}
    for listing in info_dir.glob('*.list'):
        package = listing.name[:-5]
        for line in listing.read_text(errors='replace').splitlines():
            if line.startswith('/'):
                index.setdefault(Path(line).name, []).append((package, line))
    return index


def package_metadata(package):
    data = subprocess.check_output(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}', package], text=True, stderr=subprocess.DEVNULL).strip().split('\t')
    if len(data) != 4 or not all(data):
        raise ValueError('Incomplete package metadata: ' + package)
    return dict(zip(('binary', 'binary_version', 'source', 'source_version'), data))


def elf_fingerprint(path):
    """Evidence for review only: equal build ID and .text do not prove identity."""
    try:
        note = subprocess.check_output(['readelf', '-n', str(path)], text=True, stderr=subprocess.DEVNULL)
        build = re.search(r'Build ID: ([0-9a-fA-F]+)', note)
        sections = subprocess.check_output(['readelf', '-SW', str(path)], text=True, stderr=subprocess.DEVNULL)
        section = re.search(r'\]\s+\.text\s+PROGBITS\s+[0-9a-fA-F]+\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)', sections)
        if not build or not section:
            return None
        offset, size = int(section[1], 16), int(section[2], 16)
        if not size or offset + size > path.stat().st_size:
            return None
        digest = hashlib.sha256()
        with path.open('rb') as f:
            f.seek(offset)
            remaining = size
            while remaining:
                block = f.read(min(CHUNK, remaining))
                if not block:
                    return None
                digest.update(block)
                remaining -= len(block)
        return {'build_id': build[1].lower(), 'text_sha256': digest.hexdigest(), 'text_bytes': size}
    except (OSError, subprocess.CalledProcessError):
        return None


def inventory_tree(tree, image_hash, index):
    files = []
    total = 0
    metadata = {}
    fingerprints = {}
    for base, dirs, names in os.walk(tree, followlinks=False):
        base = Path(base)
        for name in sorted(dirs + names):
            path = base / name
            rel = path.relative_to(tree).as_posix()
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            if len(files) >= MAX_FILES:
                raise ValueError('Too many archive entries')
            if stat.S_ISLNK(info.st_mode):
                files.append({'path': rel, 'type': 'symlink', 'target': os.readlink(path)})
                continue
            if not stat.S_ISREG(info.st_mode):
                raise ValueError('Special file refused: ' + rel)
            total += info.st_size
            if total > MAX_UNPACKED:
                raise ValueError('Archive exceeds unpacked-byte limit')
            with path.open('rb') as f:
                elf = f.read(4) == b'\x7fELF'
            record = {'path': rel, 'type': 'file', 'bytes': info.st_size, 'sha256': sha256(path),
                      'elf': elf, 'font': path.suffix.lower() in ('.ttf', '.otf', '.woff', '.woff2', '.ttc')}
            # Keep *all* files in the inventory. Only exact byte equality can
            # establish a local binary-package match; same SONAME/build-id alone
            # is not enough after linuxdeploy has rewritten ELF files.
            candidates = []
            provisional = []
            local_fp = None
            if elf or record['font']:
                for package, host_path in index.get(name, []):
                    host = Path(host_path)
                    try:
                        if not host.is_file():
                            continue
                        exact = host.stat().st_size == info.st_size and sha256(host) == record['sha256']
                        if not exact and elf:
                            local_fp = local_fp or elf_fingerprint(path)
                            key = str(host.resolve())
                            if key not in fingerprints:
                                fingerprints[key] = elf_fingerprint(host)
                            same_code = local_fp is not None and local_fp == fingerprints[key]
                        else:
                            same_code = False
                        if not exact and not same_code:
                            continue
                        if package not in metadata:
                            metadata[package] = package_metadata(package)
                        match = {'package': metadata[package], 'host_path': host_path}
                        if exact:
                            candidates.append(match)
                        else:
                            match['fingerprint'] = local_fp
                            provisional.append(match)
                    except (OSError, ValueError, subprocess.CalledProcessError):
                        continue
                record['exact_package_matches'] = candidates
                record['provisional_build_id_and_text_matches'] = provisional
                record['source_status'] = 'exact-byte-match-needs-license-and-replacement-review' if candidates else 'unresolved'
            files.append(record)
    return {'format': 1, 'appimage_sha256': image_hash, 'file_count': len(files),
            'unpacked_regular_bytes': total, 'files': files, 'release_clearance': False,
            'limitations': ['Exact matches identify local binary packages only; local package database is not proof of build provenance.',
              'Unmatched native files, licensing, actual source correspondence, and replacement/relinking need independent review.',
              'This inventory does not establish source access, replacement ability, or legal clearance.']}


def inventory(image, output, expected):
    image = image.resolve(strict=True)
    if not image.is_file() or image.stat().st_size > MAX_IMAGE:
        raise ValueError('AppImage missing or exceeds image size limit')
    actual = sha256(image)
    if actual != expected.lower():
        raise ValueError('AppImage SHA-256 does not match explicit expected hash')
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing existing output path')
    output.mkdir(parents=True)
    tree = output / 'appdir'
    offset = image_offset(image)
    # Bound file count and advertised uncompressed sizes before extraction.
    # Refuse unexpected listing formats rather than guessing about path names.
    listing = subprocess.run(['unsquashfs', '-lln', '-offset', str(offset), str(image)], check=True, capture_output=True, text=True).stdout.splitlines()
    total = 0
    if len(listing) > MAX_FILES:
        raise ValueError('Archive exceeds entry limit')
    for line in listing:
        match = re.match(r'^([dl-])[rwxStTs-]{9}\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+', line)
        if not match:
            raise ValueError('Unsupported or unsafe archive listing entry')
        if match[1] == '-':
            total += int(match[2])
            if total > MAX_UNPACKED:
                raise ValueError('Archive exceeds advertised unpacked-byte limit')
    subprocess.run(['unsquashfs', '-no-progress', '-no-xattrs', '-processors', '2', '-offset', str(offset), '-d', str(tree), str(image)], check=True, stdout=subprocess.DEVNULL)
    if sha256(image) != actual:
        raise ValueError('AppImage changed during extraction')
    report = inventory_tree(tree, actual, package_index())
    report.update({'appimage': str(image), 'squashfs_offset': offset})
    (output / 'inventory.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def dsc_checksums(path):
    result = {}
    active = False
    for line in path.read_text(errors='strict').splitlines():
        if line == 'Checksums-Sha256:':
            active = True
            continue
        if active:
            if not line.startswith(' '):
                break
            parts = line.split()
            if len(parts) != 3 or not re.fullmatch('[0-9a-f]{64}', parts[0]) or not parts[1].isdigit() or Path(parts[2]).name != parts[2]:
                raise ValueError('Invalid .dsc checksum entry')
            if parts[2] in result:
                raise ValueError('Duplicate .dsc checksum filename')
            result[parts[2]] = {'sha256': parts[0], 'bytes': int(parts[1])}
    if not result:
        raise ValueError('No SHA-256 source entries in ' + str(path))
    return result


def retain_debian_copyright(dest):
    """Retain the distro notice as data; never extract arbitrary archive paths."""
    archives = sorted(dest.glob('*.debian.tar.*'))
    if len(archives) != 1:
        # Debian source format 1.0 can introduce debian/copyright as one
        # all-additions hunk in .diff.gz. Never apply the patch or execute it.
        patches = list(dest.glob('*.diff.gz'))
        if len(archives) != 0 or len(patches) != 1:
            return {'status': 'unavailable', 'reason': 'No unique Debian source delta; inspect source manually'}
        try:
            with gzip.open(patches[0], 'rb') as stream:
                raw = stream.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise ValueError('Debian diff exceeds inspection limit')
            lines = raw.decode('utf-8', errors='strict').splitlines(keepends=True)
            markers = [i for i, line in enumerate(lines) if re.match(r'^\+\+\+ [^\s]+/debian/copyright(?:\s|$)', line)]
            if len(markers) != 1:
                return {'status': 'unavailable', 'reason': 'No unique copyright addition in source diff'}
            at = markers[0] + 1
            hunk = re.match(r'^@@ -0,0 \+1(?:,(\d+))? @@', lines[at])
            if not hunk:
                return {'status': 'unavailable', 'reason': 'Copyright diff is not a new-file hunk'}
            count = int(hunk[1] or 1)
            additions = lines[at + 1:at + 1 + count]
            if len(additions) != count or any(not line.startswith('+') for line in additions):
                return {'status': 'unavailable', 'reason': 'Copyright diff hunk is incomplete'}
            data = ''.join(line[1:] for line in additions).encode('utf-8')
            if len(data) > 2 * 1024 * 1024:
                raise ValueError('Copyright notice exceeds limit')
            notice = dest / 'DISTRO-COPYRIGHT'
            notice.write_bytes(data)
            return {'status': 'retained', 'path': notice.name, 'sha256': sha256(notice), 'bytes': len(data), 'source': 'new-file hunk in Debian format 1.0 diff'}
        except (OSError, UnicodeError, IndexError):
            return {'status': 'unavailable', 'reason': 'Debian source diff could not be read'}
    try:
        with tarfile.open(archives[0], 'r:*') as archive:
            matches = [m for m in archive.getmembers() if m.name in ('debian/copyright', './debian/copyright')]
            if len(matches) != 1 or not matches[0].isfile() or matches[0].size > 2 * 1024 * 1024:
                return {'status': 'unavailable', 'reason': 'No unique bounded regular debian/copyright'}
            data = archive.extractfile(matches[0]).read()
    except (tarfile.TarError, OSError):
        return {'status': 'unavailable', 'reason': 'Debian delta format could not be read'}
    if len(data) != matches[0].size:
        raise ValueError('Truncated distro copyright')
    notice = dest / 'DISTRO-COPYRIGHT'
    notice.write_bytes(data)
    return {'status': 'retained', 'path': notice.name, 'sha256': sha256(notice), 'bytes': len(data)}


def collect_sources(inventory_file, output, sources_file, include_candidates=False):
    report = json.loads(inventory_file.read_text())
    source_config = sources_file.read_text()
    stanzas = [part for part in re.split(r'\n\s*\n', source_config) if part.strip()]
    for stanza in stanzas:
        fields = dict((m[1].lower(), m[2].strip()) for m in re.finditer(r'(?m)^([A-Za-z-]+):\s*([^\n]+)$', stanza))
        uris = fields.get('uris', '').split()
        key = fields.get('signed-by', '')
        if ('deb-src' not in fields.get('types', '').split() or not uris or
                any(not u.startswith('https://') for u in uris) or
                not key.startswith('/') or not Path(key).is_file() or
                fields.get('trusted', '').lower() == 'yes' or
                fields.get('allow-insecure', '').lower() == 'yes'):
            raise ValueError('Authenticated HTTPS deb-src configuration with Signed-By is required')
    if not stanzas:
        raise ValueError('Authenticated HTTPS deb-src configuration with Signed-By is required')
    if report.get('release_clearance') is not False or not report.get('appimage_sha256'):
        raise ValueError('Invalid inventory input')
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing existing output path')
    output.mkdir(parents=True)
    lists = output / 'apt-lists'
    archives = output / 'apt-archives'
    (lists / 'partial').mkdir(parents=True)
    (archives / 'partial').mkdir(parents=True)
    apt = ['-o', 'Dir::Etc::sourcelist=' + str(sources_file.resolve(strict=True)),
           '-o', 'Dir::Etc::sourceparts=-', '-o', 'Dir::State::lists=' + str(lists.resolve()),
           '-o', 'Dir::Cache::archives=' + str(archives.resolve()),
           '-o', 'Dir::Cache::pkgcache=' + str((output / 'pkgcache.bin').resolve()),
           '-o', 'Dir::Cache::srcpkgcache=' + str((output / 'srcpkgcache.bin').resolve()),
           '-o', 'APT::Get::AllowUnauthenticated=false',
           '-o', 'Acquire::AllowInsecureRepositories=false', '-o', 'APT::Update::Error-Mode=any']
    with (output / 'apt-update.log').open('w') as log:
        subprocess.run(['apt-get', *apt, 'update'], check=True, stdout=log, stderr=subprocess.STDOUT, timeout=300)
    packages = {}
    for f in report['files']:
        matches = [(m, 'exact') for m in f.get('exact_package_matches', [])]
        if include_candidates:
            matches += [(m, 'provisional') for m in f.get('provisional_build_id_and_text_matches', [])]
        for match, certainty in matches:
            p = match['package']
            packages.setdefault((p['source'], p['source_version']), set()).add(certainty)
    results = []
    for name, version in sorted(packages):
        if shutil.disk_usage(output).free < 5 * 1024 ** 3:
            raise ValueError('Stopping: less than 5 GiB free disk space')
        print('Downloading', name, version, flush=True)
        if not re.fullmatch(r'[a-z0-9][a-z0-9+.-]*', name) or not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', version):
            raise ValueError('Unsafe package identity')
        dest = output / (name + '_' + version.replace(':', '%3a'))
        dest.mkdir()
        uri_cmd = subprocess.run(['apt-get', *apt, '--print-uris', 'source', '--download-only', '--only-source', name + '=' + version], cwd=dest, capture_output=True, text=True, timeout=300)
        (dest / 'source-uris.log').write_text(uri_cmd.stdout + uri_cmd.stderr)
        with (dest / 'download.log').open('w') as log:
            proc = subprocess.run(['apt-get', *apt, 'source', '--download-only', '--only-source', name + '=' + version], cwd=dest, stdout=log, stderr=subprocess.STDOUT, timeout=300)
        entry = {'source': name, 'version': version, 'match_evidence': sorted(packages[(name, version)]), 'exit': proc.returncode, 'files': []}
        if proc.returncode == 0:
            descriptions = list(dest.glob('*.dsc'))
            if len(descriptions) != 1:
                raise ValueError('Expected exactly one .dsc for ' + name)
            for filename, expected in dsc_checksums(descriptions[0]).items():
                file = dest / filename
                if not file.is_file() or file.is_symlink() or file.stat().st_size != expected['bytes'] or sha256(file) != expected['sha256']:
                    raise ValueError('Source file failed .dsc SHA-256 validation: ' + filename)
            uri_map = {}
            for line in uri_cmd.stdout.splitlines():
                m = re.match(r"^'([^']+)' (\S+) (\d+) (SHA256|SHA512):([0-9a-f]+)$", line)
                if m:
                    uri_map[m[2]] = {'url': m[1], 'bytes': int(m[3]), 'algorithm': m[4].lower(), 'digest': m[5]}
            entry['files'] = []
            for f in sorted(dest.iterdir()):
                if f.is_file() and f.name not in ('download.log', 'source-uris.log'):
                    data = {'name': f.name, 'bytes': f.stat().st_size, 'sha256': sha256(f)}
                    advertised = uri_map.get(f.name)
                    if not advertised or advertised['bytes'] != data['bytes']:
                        raise ValueError('Authenticated source index URL/size mismatch: ' + f.name)
                    with f.open('rb') as stream:
                        index_hash = hashlib.file_digest(stream, advertised['algorithm']).hexdigest()
                    if index_hash != advertised['digest']:
                        raise ValueError('Authenticated source index hash mismatch: ' + f.name)
                    data['url'] = advertised['url']
                    data['index_algorithm'] = advertised['algorithm']
                    data['index_digest'] = index_hash
                    entry['files'].append(data)
            entry['distro_copyright'] = retain_debian_copyright(dest)
        results.append(entry)
        (output / 'progress.json').write_text(json.dumps(results, indent=2) + '\n')
    result = {'appimage_sha256': report['appimage_sha256'], 'sources': results,
              'unresolved_native_files': sum(f.get('source_status') == 'unresolved' for f in report['files']),
              'release_clearance': False,
              'included_provisional_candidates': include_candidates,
              'limitations': ['Build-id and .text matches are provisional and are not proof of package provenance.', 'Apt signed index verifies retrieval; source license, replacement and relinking review remain required.']}
    (output / 'sources.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='command', required=True)
    i = sub.add_parser('inventory')
    i.add_argument('--appimage', type=Path, required=True)
    i.add_argument('--sha256', required=True)
    i.add_argument('--output', type=Path, required=True)
    c = sub.add_parser('collect')
    c.add_argument('--inventory', type=Path, required=True)
    c.add_argument('--output', type=Path, required=True)
    c.add_argument('--sources-file', type=Path, required=True, help='Authenticated deb-src .sources file')
    c.add_argument('--include-candidate-sources', action='store_true', help='Also retrieve provisional build-id/.text matches; never marks them verified')
    a = p.parse_args()
    try:
        if a.command == 'inventory':
            r = inventory(a.appimage, a.output, a.sha256)
            print(json.dumps({'inventory': str(a.output / 'inventory.json'), 'files': r['file_count'], 'unresolved': sum(f.get('source_status') == 'unresolved' for f in r['files']), 'release_clearance': False}))
        else:
            r = collect_sources(a.inventory, a.output, a.sources_file, a.include_candidate_sources)
            failures = sum(x['exit'] != 0 for x in r['sources'])
            print(json.dumps({'sources': str(a.output / 'sources.json'), 'packages': len(r['sources']), 'failures': failures, 'unresolved': r['unresolved_native_files'], 'release_clearance': False}))
            if failures:
                return 2
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print('Linux source collection failed: ' + str(e), file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
