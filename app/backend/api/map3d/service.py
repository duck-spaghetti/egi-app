"""Read the active 3D data set version from the importer's runtime root.

The importer writes versions/<version>/ and active.json (its manifest: format,
version, files with bytes and sha256). Only the active version and only the files
listed in its manifest are served; anything else is absent. A missing or invalid
active manifest makes the 3D mode unavailable, never an error page.
"""
import json
import re
from pathlib import Path

FORMAT = 1
VERSION = re.compile(r'^[0-9]{8}T[0-9]{6}Z$')
# Files the 3D style needs; a version lacking one is not offered.
REQUIRED = ('basemap.pmtiles', 'buildings.pmtiles', 'bridges.pmtiles', 'fountains.pmtiles',
            'landmarks.geojson', 'landmark-labels.geojson')


class Map3d:
    """Resolve the active version and its files; cache the manifest by modification time."""

    def __init__(self, root: Path):
        """Remember the configured root only; nothing is read at construction."""
        self.root = Path(root)
        self._cache = (None, None)

    def active(self) -> dict | None:
        """Active manifest when it is valid and its version folder exists, else None."""
        path = self.root / 'active.json'
        try:
            stamp = path.stat().st_mtime_ns
        except OSError:
            return None
        if self._cache[0] == stamp:
            return self._cache[1]
        manifest = None
        try:
            data = json.loads(path.read_text())
            files = data.get('files')
            if (data.get('format') == FORMAT and VERSION.match(str(data.get('version', '')))
                    and isinstance(files, dict) and all(name in files for name in REQUIRED)
                    and (self.root / 'versions' / data['version']).is_dir()):
                manifest = data
        except (OSError, ValueError, AttributeError):
            manifest = None
        self._cache = (stamp, manifest)
        return manifest

    def summary(self) -> dict | None:
        """What the page needs: the active version and the base URL of its files."""
        manifest = self.active()
        if not manifest:
            return None
        return {'version': manifest['version'], 'base': f"/map3d/{manifest['version']}"}

    def file(self, version: str, name: str) -> Path | None:
        """Path of a listed file of the active version, or None."""
        manifest = self.active()
        if not manifest or version != manifest['version'] or name not in manifest['files']:
            return None
        path = (self.root / 'versions' / version / name).resolve()
        base = (self.root / 'versions' / version).resolve()
        if base not in path.parents or not path.is_file():
            return None
        return path
