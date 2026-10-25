#!/usr/bin/env python3
"""Fail packaging if the bundled terrain or its measured receipt is missing/stale."""
import hashlib
import json
from pathlib import Path
import zipfile


def verify(root):
    folder = root / "assets/terrain"
    pack = folder / "balanced.cterrain"
    receipt = json.loads((folder / "balanced.json").read_text())
    digest = hashlib.sha256()
    with pack.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if receipt["sha256"] != digest.hexdigest() or receipt["bytes"] != pack.stat().st_size:
        raise ValueError("Bundled terrain does not match its measured receipt")
    with zipfile.ZipFile(pack) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["provenance"]["source_md5"] != "5b6c47502ae8d03b8718349655d5cd95" or manifest["spacing_arc_seconds"] != 60:
            raise ValueError("Bundled terrain has an unexpected source or resolution")
        if archive.testzip() is not None:
            raise ValueError("Bundled terrain block checksum failure")
    print(f'Verified Balanced terrain: {receipt["bytes"]:,} compressed bytes')


if __name__ == "__main__":
    verify(Path(__file__).resolve().parents[1])
