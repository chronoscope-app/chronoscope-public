"""Validate the maintained workaround index without applying patches or networking."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_registry(root=ROOT):
    return json.loads((Path(root)/'docs/maintenance/workarounds.json').read_text())


def validate_registry(registry, root=ROOT):
    root = Path(root).resolve()
    if registry.get('version') != 1:
        raise ValueError('Unsupported workaround registry version')
    seen = set()
    for entry in registry['workarounds']:
        identity = entry['id']
        if not identity or identity in seen:
            raise ValueError('Workaround IDs must be unique')
        seen.add(identity)
        for field in ['owner', 'purpose', 'remove_when']:
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f'{identity}: missing {field}')
        for field in ['source_files', 'regressions']:
            if not entry.get(field):
                raise ValueError(f'{identity}: missing {field}')
            for relative in entry[field]:
                path = Path(relative)
                if path.is_absolute() or '..' in path.parts or not (root/path).is_file():
                    raise ValueError(f'{identity}: missing/unsafe {field} path {relative}')
        for constraint in entry.get('constraints', []):
            path = Path(constraint['file'])
            if path.is_absolute() or '..' in path.parts:
                raise ValueError(f'{identity}: unsafe version source')
            value = json.loads((root/path).read_text())
            for key in constraint['keys']:
                value = value[key]
            if value != constraint['expected']:
                raise ValueError(f'{identity}: dependency changed to {value}; review workaround and removal gate')
    if not seen:
        raise ValueError('The active workaround index cannot be empty')
    return sorted(seen)
