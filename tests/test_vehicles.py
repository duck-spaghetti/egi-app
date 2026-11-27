"""Vehicle HTTP filtering, freshness and the absence of request-bearing persistence."""
import io
import json
import logging
import tempfile
import time
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.api.transport.vehicles import positions
from app.backend.config import Configuration, profile
from app.backend.main import create_app


class VehicleTests(unittest.TestCase):
    """Exercise the real mounted endpoint and importer-owned snapshot contract."""

    def test_filter_freshness_missing_and_privacy(self):
        """POST area/lines filter, reject wide areas and leave no request data behind."""
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); folder=root/'transport/realtime';folder.mkdir(parents=True)
            now=int(time.time())
            path=folder/'vehicles.json'
            data={'format':'egi-vehicles/1','feed_timestamp':now,'fetched_epoch':now,'vehicles':[
                {'id':'v1','lat':41.9,'lon':12.5,'code':'PRIVATE-LINE','route_id':'r','timestamp':now-121,'bearing':None,'direction':1},
                {'id':'v2','lat':41.91,'lon':12.51,'code':'64','timestamp':now-10},
                {'id':'v3','lat':42,'lon':12.51,'code':'PRIVATE-LINE','timestamp':now}]}
            path.write_text(json.dumps(data))
            cfg=Configuration(profile(),error_dir=root/'errors',transport_roots=(root/'transport',root/'rail'))
            output=io.StringIO(); handler=logging.StreamHandler(output); logging.getLogger().addHandler(handler)
            try:
                with TestClient(create_app(cfg,{'source':StaticSubjectSource([])})) as client:
                    before={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
                    body={'west':12.49,'south':41.89,'east':12.52,'north':41.92,'lines':['PRIVATE-LINE']}
                    response=client.post('/api/preview/transit/vehicles',json=body)
                    self.assertEqual(response.status_code,200)
                    result=response.json()
                    self.assertEqual([v['id'] for v in result['vehicles']],['v1'])
                    self.assertGreaterEqual(result['vehicles'][0]['age'],121)
                    self.assertEqual((result['licence'],result['attribution']),('CC BY-SA','Roma Mobilità'))
                    self.assertFalse(result['stale']);self.assertEqual(response.headers['cache-control'],'no-store')
                    body['lines']=[]
                    self.assertEqual(len(client.post('/api/preview/transit/vehicles',json=body).json()['vehicles']),2)
                    body['east']=13
                    self.assertEqual(client.post('/api/preview/transit/vehicles',json=body).status_code,422)
                    self.assertNotIn('PRIVATE-LINE',output.getvalue());self.assertNotIn('12.49',output.getvalue())
                    after={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
                    # Invalid request diagnostics may contain only approved generic codes.
                    self.assertEqual({p:b for p,b in after.items() if '/errors/' not in p},before)
                    for p,b in after.items():
                        if '/errors/' in p:
                            self.assertNotIn(b'PRIVATE-LINE',b);self.assertNotIn(b'12.49',b)
                    data['feed_timestamp']=now-181;path.write_text(json.dumps(data))
                    stale=client.post('/api/preview/transit/vehicles',json={**body,'east':12.52}).json()
                    self.assertTrue(stale['stale']);self.assertEqual(stale['vehicles'],[])
                    path.unlink()
                    self.assertEqual(client.post('/api/preview/transit/vehicles',json={**body,'east':12.52}).json()['availability'],'unavailable')
            finally:
                logging.getLogger().removeHandler(handler)

    def test_future_and_broken_snapshots(self):
        """Invalid timestamps/content cannot masquerade as live data."""
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'realtime').mkdir();p=root/'realtime/vehicles.json'
            for value in ['broken',json.dumps({'format':'egi-vehicles/1','vehicles':[],'feed_timestamp':1001,'fetched_epoch':1000})]:
                p.write_text(value)
                result=positions(root,(12,41,13,42),now=1000)
                self.assertTrue(result['stale']);self.assertEqual(result['vehicles'],[])
