"""Serve the active 3D data set through the real application (in process)."""
import gzip
import hashlib
import json
import re
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.backend.api.map3d.service import REQUIRED, Map3d
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, profile
from app.backend.main import create_app

VERSION = '20261126T120000Z'


def data_set(root: Path, version: str = VERSION, activate: bool = True) -> Path:
    """A version folder with every required file and an active manifest in the importer's layout."""
    folder = root / 'versions' / version
    folder.mkdir(parents=True)
    files = {}
    for name in (*REQUIRED, 'fonts/Noto Sans Regular/0-255.pbf'):
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(range(256)) * 4)
        files[name] = {'bytes': 1024, 'sha256': 'x'}
    if activate:
        (root / 'active.json').write_text(json.dumps({'format': 1, 'version': version, 'files': files}))
    return folder


class Map3dHttpTests(unittest.TestCase):
    """Active files, Range, unknown version, unavailability and the current map page."""

    def client(self, root: Path) -> TestClient:
        config = Configuration(profile(), error_dir=root / 'errors', map3d_root=root / 'map3d')
        return TestClient(create_app(config, {'source': StaticSubjectSource([])}))

    def test_active_files_range_and_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_set(root / 'map3d')
            with self.client(root) as client:
                active = client.get('/map3d/active').json()
                self.assertEqual((active['availability'], active['base']), ('available', f'/map3d/{VERSION}'))
                full = client.get(f'/map3d/{VERSION}/basemap.pmtiles')
                self.assertEqual((full.status_code, len(full.content)), (200, 1024))
                self.assertIn('immutable', full.headers['cache-control'])
                part = client.get(f'/map3d/{VERSION}/basemap.pmtiles', headers={'Range': 'bytes=10-19'})
                self.assertEqual(part.status_code, 206)
                self.assertEqual(part.content, bytes(range(10, 20)))
                self.assertEqual(part.headers['content-range'], 'bytes 10-19/1024')
                font = client.get(f'/map3d/{VERSION}/fonts/Noto Sans Regular/0-255.pbf')
                self.assertEqual(font.status_code, 200)
                self.assertEqual(client.get('/map3d/active').headers['cache-control'], 'no-store')

    def test_bridge_gzip_contract_and_active_descriptor(self):
        """Browser-decoded gzip matches the descriptor checksum and remains active-only."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = data_set(root / 'map3d')
            manifest_path = root / 'map3d' / 'active.json'
            manifest = json.loads(manifest_path.read_text())
            body = b'{"format":1,"chunks":[]}'
            for name, content in [('bridge-plan.pmtiles', b'plan'),
                                  ('bridge-mesh/index.json.gz', gzip.compress(body, mtime=0))]:
                path = folder / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
                manifest['files'][name] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
            manifest_path.write_text(json.dumps(manifest))
            with self.client(root) as client:
                descriptor = client.get('/map3d/active').json()['bridgeMesh']
                response = client.get(f'/map3d/{VERSION}/bridge-mesh/index.json.gz')
                self.assertEqual(response.headers['content-encoding'], 'gzip')
                self.assertEqual(response.content, body)
                self.assertEqual(descriptor['sha256'], hashlib.sha256(response.content).hexdigest())
                self.assertEqual(descriptor['bytes'], len(body))
                self.assertEqual(client.get('/map3d/20200101T000000Z/bridge-mesh/index.json.gz').status_code, 404)

    def test_unknown_version_unlisted_file_and_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_set(root / 'map3d')
            data_set(root / 'map3d', '20250101T000000Z', activate=False)
            (root / 'map3d' / 'versions' / VERSION / 'secret.txt').write_text('no')
            with self.client(root) as client:
                self.assertEqual(client.get('/map3d/20250101T000000Z/basemap.pmtiles').status_code, 404)
                self.assertEqual(client.get(f'/map3d/{VERSION}/secret.txt').status_code, 404)
                self.assertEqual(client.get(f'/map3d/{VERSION}/../active.json').status_code, 404)
                self.assertEqual(client.get(f'/map3d/{VERSION}/%2e%2e/%2e%2e/active.json').status_code, 404)
                self.assertEqual(client.get('/map3d/x/basemap.pmtiles').headers['cache-control'], 'no-store')

    def test_missing_or_invalid_active_version_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.client(root) as client:
                self.assertEqual(client.get('/map3d/active').json(), {'availability': 'unavailable'})
                self.assertIn('map3d: null', client.get('/map').text)
            (root / 'map3d').mkdir()
            (root / 'map3d' / 'active.json').write_text('{"format": 1, "version": "../x", "files": {}}')
            self.assertIsNone(Map3d(root / 'map3d').active())
            (root / 'map3d' / 'active.json').write_text('not json')
            self.assertIsNone(Map3d(root / 'map3d').active())

    def test_current_map_page_loads_no_3d_library_or_data(self):
        """The Leaflet map references neither MapLibre, PMTiles nor data set files."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data_set(root / 'map3d')
            with self.client(root) as client:
                page = client.get('/map').text
            loaded = re.findall(r'<(?:script|link)[^>]*(?:src|href)="([^"]+)"', page)
            self.assertTrue(loaded)
            self.assertFalse([url for url in loaded if re.search(r'maplibre|pmtiles|/map3d/', url, re.I)])
            self.assertNotIn('maplibre', page.lower())
            self.assertNotIn('pmtiles', page.lower())
            self.assertIn(f'"base": "/map3d/{VERSION}"', page)


if __name__ == '__main__':
    unittest.main()
