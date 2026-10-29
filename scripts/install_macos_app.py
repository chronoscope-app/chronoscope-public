#!/usr/bin/env python3
"""Install the latest local build in ~/Applications, replacing old app copies."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

BUNDLE_ID = 'org.chronoscope.desktop'


def metadata(bundle):
    with (bundle/'Contents/Info.plist').open('rb') as handle:
        return plistlib.load(handle)


def remove(path):
    if path.is_symlink():
        path.unlink()
    else:
        shutil.rmtree(path)


def is_chronoscope(bundle):
    if bundle.suffix.lower() != '.app':
        return False
    try:
        identity = metadata(bundle).get('CFBundleIdentifier', '')
        return identity == BUNDLE_ID or identity.startswith('org.chronoscope.')
    except (OSError, ValueError, plistlib.InvalidFileException):
        return False


def install(source):
    if sys.platform != 'darwin':
        raise RuntimeError('This installer requires macOS')
    source = source.resolve(strict=True)
    info = metadata(source)
    if info.get('CFBundleIdentifier') != BUNDLE_ID:
        raise ValueError('Expected a Chronoscope app bundle')
    applications = Path.home()/'Applications'
    applications.mkdir(exist_ok=True)
    destination = applications/'Chronoscope.app'
    if source == destination.resolve():
        raise ValueError('Build outside ~/Applications before installing')
    stage = Path(tempfile.mkdtemp(prefix='.chronoscope-install-', dir=applications))
    previous = stage/'previous.app'
    try:
        staged = stage/'Chronoscope.app'
        subprocess.run(['/usr/bin/ditto', str(source), str(staged)], check=True)
        subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(staged)], check=True)
        if destination.exists() or destination.is_symlink():
            os.replace(destination, previous)
        try:
            os.replace(staged, destination)
        except BaseException:
            if previous.exists() or previous.is_symlink():
                os.replace(previous, destination)
            raise
        # Only app bundles belonging to Chronoscope; leave unrelated apps/data.
        for old in applications.iterdir():
            if old != destination and is_chronoscope(old):
                remove(old)
                print('Removed old app:', old)
        print('Installed Chronoscope {}: {}'.format(
            info['CFBundleShortVersionString'], destination))
    finally:
        if (previous.exists() or previous.is_symlink()) and not destination.exists():
            print('Previous app retained for recovery: {}'.format(previous), file=sys.stderr)
        else:
            shutil.rmtree(stage)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    install(parser.parse_args().bundle)
