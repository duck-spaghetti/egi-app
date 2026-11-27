"""Inspect local database environments; no lifecycle mutation commands are provided."""
import argparse
import json
from pathlib import Path
from devchecks.environments import Inventory


def main(argv=None):
    """Print a fresh inventory and return2 when requested observations are incomplete."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['status'])
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    result = Inventory(args.workspace).collect()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Environment inventory: {result['status']} (read-only)")
        for entry in result['entries']:
            size = '?' if entry['allocated_bytes'] is None else f"{entry['allocated_bytes']/1024**2:.1f} MiB"
            print(f"{entry['state']:12} {entry['category']:12} {size:>12} {entry['disposition']:22} {entry['path']}")
        for error in result['errors']:
            print(f"UNVERIFIED {error['operation']}: {error['path']} ({error['error']})")
    return 2 if result['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
