#!/usr/bin/env python3
"""Preview or prune old completed validation profiles; retain all evidence."""
import argparse
import datetime
import json
from pathlib import Path
import shutil
import sys
from guarded_run import workspace_lock, is_guarded

ROOT = Path(__file__).resolve().parent.parent


def plan(root=ROOT, days=7, keep=3, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    runs = Path(root).resolve()/'.qa/local-validation/runs'
    completed = []
    for run in runs.iterdir() if runs.is_dir() else []:
        try:
            if run.is_symlink() or not run.is_dir():
                continue
            receipt = json.loads((run/'run.json').read_text())
            finished = datetime.datetime.fromisoformat(receipt['finished_utc'])
            if finished.tzinfo is None:
                continue
            completed.append((finished, run))
        except (OSError, ValueError, KeyError):
            continue
    result = []
    for finished, run in sorted(completed, reverse=True)[keep:]:
        if (now-finished).total_seconds() < days*86400:
            continue
        profiles = run/'profiles'
        # Only disposable per-suite profiles. Never native-profile, saved
        # workspaces, receipts, logs, screenshots, binaries or recovery data.
        if profiles.is_dir() and not profiles.is_symlink():
            if profiles.resolve() != profiles.absolute():
                continue
            result.append(profiles)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--keep', type=int, default=3)
    args = parser.parse_args()
    if args.days < 1 or args.keep < 1:
        parser.error('Retain at least one day and one completed run')
    paths = plan(days=args.days, keep=args.keep)
    for path in paths:
        print(('Removing ' if args.apply else 'Would remove ') + str(path))
        if args.apply:
            shutil.rmtree(path)
    print(f'{len(paths)} old completed profile directories; evidence and native app profiles retained.')
    return 0


if __name__ == '__main__':
    if is_guarded() or any(a in sys.argv for a in ['--help', '-h']):
        raise SystemExit(main())
    with workspace_lock():
        raise SystemExit(main())
