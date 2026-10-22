#!/usr/bin/env python3
"""Reproduce the bundled EGM96 centimetre grid from the original PROJ GTX.

No network access. Obtain egm96_15.gtx from proj-datumgrid-1.8.zip or the
system proj-data package; the input checksum is verified before conversion.
"""
import argparse
import hashlib
import math
from pathlib import Path
import struct

SOURCE_SHA256 = "c02a6eb70a7a78efebe5adf3ade626eb75390e170bb8b3f36136a2c28f5326a0"
ASSET_SHA256 = "246249f1b6d0dd4da5d79572775a2d21dcf56fe0836aab512ffcf5a01737d194"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Original egm96_15.gtx file")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "frontend/src/assets/egm96-15-cm.bin")
    args = parser.parse_args()
    source = args.source.read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        parser.error("Source does not match the documented original EGM96 grid")
    if struct.unpack(">4d2i", source[:40]) != (-90.0, -180.0, 0.25, 0.25, 721, 1440):
        parser.error("Unexpected grid dimensions or geographic ordering")
    values = struct.unpack(">" + str(721 * 1440) + "f", source[40:])
    if any(not math.isfinite(v) or abs(v) > 327.67 for v in values):
        parser.error("Invalid geoid undulation or centimetre encoding overflow")
    result = struct.pack("<" + str(len(values)) + "h", *(round(v * 100) for v in values))
    if hashlib.sha256(result).hexdigest() != ASSET_SHA256:
        parser.error("Conversion did not reproduce the documented derived asset")
    args.output.write_bytes(result)
    print(f"Wrote {len(result):,} bytes; SHA-256 {ASSET_SHA256}")


if __name__ == "__main__":
    main()
