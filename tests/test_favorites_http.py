"""Verify favorites shell delivery and its explicit offline resource graph."""
import json
from pathlib import Path
import re
import tempfile
import unittest

from fastapi.testclient import TestClient
from app.backend.config import Configuration, profile
from app.backend.main import create_app
from app.backend.api.preview.subjects import StaticSubjectSource


class FavoritesShellTests(unittest.TestCase):
    """The public shell needs no service read and the worker has a narrow scope."""

    def test_shell_worker_and_allowlist(self):
        """All explicit offline assets exist; no private or external URL is cached."""
        with tempfile.TemporaryDirectory() as root:
            app = create_app(Configuration(profile(), error_dir=Path(root)),
                             {'source': StaticSubjectSource([])})
            with TestClient(app) as client:
                shell = client.get('/preferiti')
                self.assertEqual(shell.status_code, 200)
                self.assertNotIn('leaflet', shell.text)
                self.assertNotIn('database_url', shell.text)
                lists = client.get('/preferiti/liste')
                self.assertEqual(lists.status_code, 200)
                self.assertIn('collection-document', lists.text)
                self.assertNotIn('leaflet', lists.text)
                worker = client.get('/preferiti/sw.js')
                self.assertEqual(worker.status_code, 200)
                self.assertEqual(worker.headers['Service-Worker-Allowed'], '/preferiti')
                self.assertIn('javascript', worker.headers['content-type'])
                paths = json.loads(re.search(r'const ASSETS = (\[.*?\]);', worker.text, re.S)[1])
                for path in paths:
                    self.assertTrue(path in ('/preferiti', '/preferiti/liste') or path.startswith(('/static/', '/translations/')))
                    self.assertEqual(client.get(path).status_code, 200, path)
                modules = {path for path in paths if path.endswith('.js')}
                for path in modules:
                    for reference in re.findall(r'from [\'\"]([^\'\"]+)[\'\"]', client.get(path).text):
                        from urllib.parse import urljoin
                        self.assertIn(urljoin(path, reference), modules)

    def test_favorites_labels_are_present_in_every_current_dictionary(self):
        """All active dictionaries provide the same favorites key contract."""
        folder = Path(__file__).resolve().parents[1] / 'translations'
        dictionaries = [{**json.loads(path.read_text())['favorites'], **{f'lists.{k}':v for k,v in json.loads(path.read_text())['lists'].items()}} for path in folder.glob('*.json')]
        for dictionary in dictionaries:
            self.assertEqual(set(dictionary), set(dictionaries[0]))
            self.assertTrue(all(isinstance(value, str) and value for value in dictionary.values()))
