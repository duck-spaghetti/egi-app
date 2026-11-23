"""Verify actual privacy/configuration boundaries, not just the declared settings."""
import json
import logging
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.backend.main import app
from app.backend import geocoding, local_routes
from app.backend.app_profile import profile, resolved
from app.backend.diagnostics import Diagnostics, RETENTION


class PrivacyTests(unittest.TestCase):
    """Sentinel input never survives in URLs, errors, diagnostics or cache keys."""

    def test_validation_and_unhandled_error_redact_all_input(self):
        """Real HTTP handlers contain validation detail and unexpected exception messages."""
        with tempfile.TemporaryDirectory() as temp:
            logger=Diagnostics(Path(temp))
            with patch('app.backend.diagnostics.DIAGNOSTICS',logger):
                with TestClient(app) as client:
                    bad=client.post('/api/preview/transit/origin',json={'lat':'SECRET_QUERY_123','lon':12.5})
                    self.assertEqual(bad.status_code,422)
                    self.assertNotIn('SECRET_QUERY_123',bad.text)
                    self.assertEqual(client.get('/api/preview/transit/origin').status_code,405)
                    with patch.object(local_routes,'nearby_transit',side_effect=RuntimeError('SECRET_QUERY_123 127.0.0.1 password')):
                        failed=client.post('/api/preview/transit/origin',json={'lat':41.9,'lon':12.5})
                    self.assertEqual(failed.status_code,500)
                    content=failed.text+''.join(path.read_text() for path in Path(temp).glob('*.json'))
                    for value in ['SECRET_QUERY_123','127.0.0.1','password','41.9','12.5']:
                        self.assertNotIn(value,content)
                    self.assertTrue(logging.getLogger('uvicorn.access').disabled)

    def test_diagnostics_expire_and_foreign_files_are_preserved(self):
        """Expired events are removed on startup cleanup, without touching unrelated files."""
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); logger=Diagnostics(root)
            identifier=logger.record('internal_error',now=100)
            foreign=root/'keep.json';foreign.write_text('{}')
            logger.prune(100+RETENTION-1)
            self.assertTrue((root/(identifier+'.json')).exists())
            logger.prune(100+RETENTION)
            self.assertFalse((root/(identifier+'.json')).exists())
            self.assertTrue(foreign.exists())

    def test_cache_keys_expiry_and_configuration_scope(self):
        """Cache keys contain no clear search and active cleanup erases expired responses."""
        geocoding._CACHE.clear()
        self.addCleanup(geocoding._CACHE.clear)
        with tempfile.TemporaryDirectory() as temp, patch.object(geocoding,'RATE_FILE',Path(temp)/'rate'), patch.object(geocoding.time,'sleep'):
            fetch=lambda query:[{'lat':41.9,'lon':12.5,'display_name':'temporary result'}]
            with patch.object(geocoding.time,'monotonic',return_value=100):
                geocoding.search_address('SECRET_SEARCH_123',fetch)
            self.assertEqual(len(geocoding._CACHE),1)
            self.assertNotIn('SECRET_SEARCH_123',repr(list(geocoding._CACHE)))
            self.assertTrue(all(isinstance(key,bytes) for key in geocoding._CACHE))
            with patch.object(geocoding.time,'monotonic',return_value=400):
                geocoding.expire_cache()
            self.assertFalse(geocoding._CACHE)

    def test_config_resolves_canonical_values_and_rejects_duplicate_keys(self):
        """The same city settings serve callers; malformed YAML fails without values."""
        result=resolved({'name':'Synthetic city','country_code':'ES','timezone_name':'Europe/Madrid','code':'synthetic'})
        self.assertEqual((result['name'],result['timezone']),('Synthetic city','Europe/Madrid'))
        self.assertNotIn('database_url',result)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'profile.yaml';path.write_text('territory_code: SECRET\nterritory_code: OTHER\n')
            with patch.dict(os.environ,{'EGI_APP_CONFIG':str(path)}):
                profile.cache_clear()
                with self.assertRaisesRegex(RuntimeError,'Invalid application profile') as error:
                    profile()
                self.assertNotIn('SECRET',str(error.exception))
            profile.cache_clear()


class PostContractTests(unittest.TestCase):
    """The coordinate-free POST contracts reject old GET forms and invalid bodies."""

    def test_old_coordinate_get_forms_return_405(self):
        """No compatibility redirect keeps coordinates or search text in a URL."""
        with tempfile.TemporaryDirectory() as temp, patch('app.backend.diagnostics.DIAGNOSTICS',Diagnostics(Path(temp))):
            with TestClient(app) as client:
                for path in ['/api/preview/address-search?q=Roma','/api/preview/transit/origin?lat=41.9&lon=12.5',
                             '/api/preview/transport?west=12.4&south=41.8&east=12.6&north=42&zoom=12',
                             '/api/preview/cycleways?west=12.4&south=41.8&east=12.6&north=42&zoom=12']:
                    self.assertEqual(client.get(path).status_code,405,path)

    def test_transport_and_cycleway_bodies_are_bounded(self):
        """Unknown fields/modes, nonfinite values, zoom, extent and route count fail as 422."""
        good={'west':12.4,'south':41.8,'east':12.6,'north':42.0,'zoom':12}
        bad=[{**good,'extra':1},{**good,'modes':'metro,ferry'},{**good,'zoom':20},{**good,'zoom':-1},
             {**good,'west':12.7},{**good,'north':43.5},{**good,'routes':','.join(f'r{i}' for i in range(81))},
             {**good,'routes':''}]
        with tempfile.TemporaryDirectory() as temp, patch('app.backend.diagnostics.DIAGNOSTICS',Diagnostics(Path(temp))):
            with TestClient(app) as client:
                for body in bad:
                    self.assertEqual(client.post('/api/preview/transport',json=body).status_code,422,body)
                nan=client.post('/api/preview/cycleways',content='{"west":NaN,"south":41.8,"east":12.6,"north":42,"zoom":12}',
                                headers={'content-type':'application/json'})
                self.assertEqual(nan.status_code,422)
                self.assertEqual(client.post('/api/preview/cycleways',json={**good,'modes':'bus'}).status_code,422)
                self.assertEqual(client.post('/api/preview/address-search',json={'query':'ab'}).status_code,422)
                self.assertEqual(client.post('/api/preview/address-search',json={'query':'x'*201}).status_code,422)
                records=[json.loads(path.read_text())['code'] for path in Path(temp).glob('*.json')]
                self.assertEqual(set(records),{'invalid_request'})
