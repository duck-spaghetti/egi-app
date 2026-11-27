"""Durable worker/native HTTP contracts with controlled provider exchanges only."""
import getpass
from copy import deepcopy
import json
from pathlib import Path
import tempfile
from threading import Event
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
import httpx
import psycopg
from psycopg.types.json import Jsonb
from pydantic import SecretStr

from app.backend.api.moderation import auth
from app.backend.api.preparations.interpretation.provider import OpenAIAdapter
from app.backend.api.preparations.interpretation.queue import JobQueue
from app.backend.api.preparations.interpretation.runner import Worker, build_request
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, EditorialSettings, profile
from app.backend.main import create_app
from tests.community_fixtures import CONFIG, result
from tests.native import REPOSITORY, Cluster, people

BASE = '/moderazione/contribuisci/api'
ROOT = Path(__file__).resolve().parents[1]
SECRET = 'w' * 40


@unittest.skipUnless(REPOSITORY,'needs explicit EGI_DATABASE_REPO native schema fixture')
class WorkerNativeTests(unittest.TestCase):
    """Prove committed dispatch, private payloads, accounting and restart behavior."""

    @classmethod
    def setUpClass(cls):
        """Deploy a socket-only fixture with isolated editorial/worker logins."""
        cls.cluster = Cluster.__new__(Cluster)
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.__init__(65459,'egi_community_worker')
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql',Path(REPOSITORY)/'tests/contract/helpers.sql',ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_community_desk LOGIN IN ROLE egi_editorial')
        cls.cluster.sql('CREATE ROLE egi_community_worker LOGIN IN ROLE egi_preparation_worker')
        cls.people = people(cls.cluster,'egi_community_desk')
        cls.owner = psycopg.connect(cls.cluster.dsn(getpass.getuser()),autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        cls.owner.execute('INSERT INTO preparation.ai_configurations(version,provider_config,max_input_tokens,max_output_tokens,input_rate_microusd_per_million,cached_rate_microusd_per_million,output_rate_microusd_per_million,verified_at,price_reference) VALUES(%s,%s,300000,2000,1000000,500000,1000000,clock_timestamp(),%s)',('fixture/1',Jsonb(CONFIG),'Synthetic fixture; no provider calls'))
        cls.owner.execute("INSERT INTO preparation.ai_settings(config_version,enabled) VALUES('fixture/1',true)")
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.app = create_app(Configuration(profile(),canonical=True,error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_community_desk'),cookie_secret=SECRET,secure_cookie=False)),{'source':StaticSubjectSource([])})

    def setUp(self):
        """Open a verified moderator browser and a worker-only queue."""
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__,None,None,None)
        self.client.cookies.set('egi_moderation','mod1',path='/moderazione')
        self.headers = {'origin':'http://testserver','X-EGI-Form-Token':auth.form_token(SECRET,auth.token_hash('mod1'))}
        self.queue = JobQueue(self.cluster.dsn('egi_community_worker'))

    def post(self, path, body):
        """POST typed JSON through the actual protected application."""
        return self.client.post(BASE+path,json=body,headers=self.headers)

    def prepare(self, text='Sportello', private=False):
        """Create public-attested source text and optionally private contact identities."""
        source = self.post('/fonti',{'metadata':{'name':'Synthetic worker source','source_kind':'directory'},'request_key':str(uuid4())}).json()['source_id']
        workspace = self.post('/preparazioni',{'source_id':source,'title':'Worker fixture','request_key':str(uuid4())}).json()['id']
        upload = self.client.post(BASE+'/preparazioni/'+workspace+'/input',content=text.encode(),headers={**self.headers,'Content-Type':'text/plain; charset=utf-8','X-EGI-Expected-Revision':'1','X-EGI-Public-Material':'true','X-EGI-Request-Key':str(uuid4())})
        self.assertEqual(upload.status_code,201,upload.text)
        input_id = upload.json()['input_id']
        if private:
            created = self.post('/preparazioni/'+workspace+'/schede/crea',{'input_id':input_id,'job_id':None,'selections':[{'creation_key':str(uuid4())}],'request_key':str(uuid4())}).json()['items'][0]
            payload = self.client.get(BASE+'/preparazioni/'+workspace+'/schede/'+created['item_id']).json()['version']['payload']
            payload['service'] = {'contacts':[{'channel_type':'phone','value':'06 1234567','is_public':False}]}
            saved = self.post('/preparazioni/'+workspace+'/schede',{'changes':[{'item_id':created['item_id'],'expected_version':created['version_id'],'payload':payload}],'request_key':str(uuid4())})
            self.assertEqual(saved.status_code,200,saved.text)
        return workspace,input_id

    def enqueue(self, workspace, input_id):
        """Request exactly one durable job through the real HTTP endpoint."""
        response = self.post('/preparazioni/'+workspace+'/analisi',{'input_id':input_id,'task':'extract_text','request_key':str(uuid4())})
        self.assertEqual(response.status_code,202,response.text)
        return response.json()['job_id']

    def worker(self, handler, queue=None, max_input=None, interval=20):
        """Inject only MockTransport, never the real configured key/provider client."""
        def factory(config,key,input_limit,output_limit):
            """Retain frozen limits while replacing external I/O with a controlled exchange."""
            return OpenAIAdapter(config,key,max_input or input_limit,output_limit,httpx.MockTransport(handler))
        return Worker(queue or self.queue,SecretStr('fake-native-worker-key'),factory,interval)

    def response(self, exchange):
        """Return a valid named candidate and known usage with no open worker transaction."""
        self.assertEqual(self.owner.execute("SELECT count(*) FROM pg_stat_activity WHERE usename='egi_community_worker' AND state='idle in transaction'").fetchone()[0],0)
        req = json.loads(json.loads(exchange.content)['input'][0]['content'][0]['text'])
        value = result(req)
        value['candidates'][0]['service']['name'] = 'Sportello'
        value['candidates'][0]['evidence'][0].update(quote='Sportello',span={'start':0,'end':9})
        return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(value)}]}], 'usage':{'input_tokens':100,'output_tokens':20}},headers={'x-request-id':'native-fixture'})

    def test_success_has_no_open_transaction_and_private_identity_is_redacted(self):
        """The provider receives only eligible bytes and settlement occurs exactly once."""
        workspace,input_id = self.prepare('Sportello 06\u00a01234567',True)
        job = self.enqueue(workspace,input_id)
        calls = []

        def response(exchange):
            """Check the protected value never enters the actual serialized request."""
            calls.append(exchange)
            data = json.loads(json.loads(exchange.content)['input'][0]['content'][0]['text'])
            self.assertNotIn('1234567',data['text'])
            self.assertTrue(data['locator_map']['redactions'])
            return self.response(exchange)
        outcome = self.worker(response).run_once()
        self.assertEqual(outcome['state'],'succeeded')
        self.assertEqual(len(calls),1)
        self.assertIsNone(self.worker(response).run_once())
        visible = self.client.get(BASE+'/preparazioni/'+workspace+'/lavori/'+job).json()
        self.assertEqual(visible['state'],'succeeded')
        self.assertNotIn('lease',visible)
        self.assertNotIn('fake-native-worker-key',json.dumps(visible))
        self.assertEqual(self.owner.execute('SELECT state,settled_microusd FROM preparation.budget_reservations WHERE job_id=%s',(job,)).fetchone(),('settled',120))

    def test_invalid_or_refused_output_keeps_known_accounting(self):
        """Semantic failure and refusal still settle independently measured usage."""
        for refused in (False,True):
            workspace,input_id = self.prepare()
            job = self.enqueue(workspace,input_id)

            def response(exchange):
                """Return safe accounting with an explicitly unusable output."""
                payload = self.response(exchange).json()
                if refused:
                    payload['output'][0]['content'] = [{'type':'refusal','refusal':'PRIVATE PROVIDER TEXT'}]
                else:
                    value = json.loads(payload['output'][0]['content'][0]['text'])
                    value['candidates'][0]['service']['unsupported_key'] = 'PRIVATE PROVIDER TEXT'
                    payload['output'][0]['content'][0]['text'] = json.dumps(value)
                return httpx.Response(200,json=payload)
            self.assertEqual(self.worker(response).run_once()['state'],'failed')
            state,output,usage = self.owner.execute('SELECT state,output,usage FROM preparation.jobs WHERE id=%s',(job,)).fetchone()
            self.assertEqual(state,'failed')
            self.assertEqual(usage['input_tokens'],100)
            self.assertNotIn('PRIVATE PROVIDER TEXT',json.dumps(output))
            self.assertEqual(self.owner.execute('SELECT settled_microusd FROM preparation.budget_reservations WHERE job_id=%s',(job,)).fetchone()[0],120)

    def test_selected_candidates_updates_preserve_manual_and_cleared_values(self):
        """Only explicit selections create cards; fresh results preserve manual edits."""
        workspace,input_id = self.prepare('Sportello Sportello bis')
        job = self.enqueue(workspace,input_id)

        def response(exchange):
            """Recognize two source-backed services without assigning a physical place."""
            envelope = self.response(exchange).json()
            value = json.loads(envelope['output'][0]['content'][0]['text'])
            first = value['candidates'][0]
            first['service'].update(description='Sportello',delivery_mode='telephone')
            description = deepcopy(first['evidence'][0])
            description.update(id=str(uuid4()),path='/service/description')
            first['evidence'].append(description)
            second = deepcopy(first)
            second.update(candidate_key='two')
            second['service']['name'] = 'Sportello bis'
            second['evidence'][0].update(id=str(uuid4()),quote='Sportello bis',span={'start':10,'end':10+len('Sportello bis')})
            second['evidence'][1]['id'] = str(uuid4())
            value['candidates'].append(second)
            envelope['output'][0]['content'][0]['text'] = json.dumps(value)
            return httpx.Response(200,json=envelope)
        self.assertEqual(self.worker(response).run_once()['state'],'succeeded')
        visible = self.client.get(BASE+'/preparazioni/'+workspace+'/lavori/'+job).json()
        self.assertEqual(len(self.client.get(BASE+'/preparazioni/'+workspace).json()['items']),0)
        selected = {'input_id':input_id,'job_id':job,'selections':[{'candidate_id':visible['candidate_ids']['one']}],'request_key':str(uuid4())}
        created = self.post('/preparazioni/'+workspace+'/schede/crea',selected)
        self.assertEqual(created.status_code,201,created.text)
        item = created.json()['items'][0]
        selected['request_key'] = str(uuid4())
        self.assertEqual(self.post('/preparazioni/'+workspace+'/schede/crea',selected).json()['items'][0]['item_id'],item['item_id'])
        self.assertEqual(len(self.client.get(BASE+'/preparazioni/'+workspace).json()['items']),1)
        payload = self.client.get(BASE+'/preparazioni/'+workspace+'/schede/'+item['item_id']).json()['version']['payload']
        self.assertEqual(payload['location'],{'kind':'none'})
        payload['service']['name'] = 'Manuale'
        payload['service'].pop('description')
        payload['evidence'] = []
        payload['field_origins']['/service/name'] = {'state':'manual'}
        payload['field_origins']['/service/description'] = {'state':'cleared'}
        saved = self.post('/preparazioni/'+workspace+'/schede',{'changes':[{'item_id':item['item_id'],'expected_version':item['version_id'],'payload':payload}],'request_key':str(uuid4())})
        self.assertEqual(saved.status_code,200,saved.text)
        expected = saved.json()['items'][0]['after']
        uploaded = self.client.post(BASE+'/preparazioni/'+workspace+'/input',content=b'Sportello Sportello bis nuovo',headers={**self.headers,'Content-Type':'text/plain; charset=utf-8','X-EGI-Expected-Revision':'2','X-EGI-Public-Material':'true','X-EGI-Request-Key':str(uuid4())})
        self.assertEqual(uploaded.status_code,201,uploaded.text)
        self.assertEqual(self.post('/preparazioni/'+workspace+'/schede/crea',{**selected,'request_key':str(uuid4())}).status_code,409)
        input_id = uploaded.json()['input_id']
        job = self.enqueue(workspace,input_id)
        self.assertEqual(self.worker(response).run_once()['state'],'succeeded')
        visible = self.client.get(BASE+'/preparazioni/'+workspace+'/lavori/'+job).json()
        applied = self.post('/preparazioni/'+workspace+'/schede/crea',{'input_id':input_id,'job_id':job,'selections':[{'candidate_id':visible['candidate_ids']['one'],'target_item_id':item['item_id'],'expected_version':expected}],'request_key':str(uuid4())})
        self.assertEqual(applied.status_code,201,applied.text)
        self.assertIn('/service/name',applied.json()['items'][0]['conflicts'])
        current = self.client.get(BASE+'/preparazioni/'+workspace+'/schede/'+item['item_id']).json()['version']['payload']
        self.assertEqual(current['service']['name'],'Manuale')
        self.assertNotIn('description',current['service'])
        self.assertEqual(len(self.client.get(BASE+'/preparazioni/'+workspace).json()['items']),1)

    def test_ambiguous_timeout_is_not_redispatched(self):
        """A timeout holds its reservation and a new worker does not call it again."""
        workspace,input_id = self.prepare()
        job = self.enqueue(workspace,input_id)
        calls = []

        def timeout(exchange):
            """Throw only within the synthetic transport after counting one dispatch."""
            calls.append(exchange)
            raise httpx.ReadTimeout('PRIVATE',request=exchange)
        self.assertEqual(self.worker(timeout).run_once()['state'],'uncertain')
        self.assertIsNone(self.worker(timeout).run_once())
        self.assertEqual(len(calls),1)
        self.assertEqual(self.owner.execute('SELECT state FROM preparation.budget_reservations WHERE job_id=%s',(job,)).fetchone()[0],'uncertain')

    def test_cancelled_result_still_settles_usage_without_output(self):
        """Cancellation during I/O cannot resurrect candidates or erase known costs."""
        workspace,input_id = self.prepare()
        job = self.enqueue(workspace,input_id)

        def response(exchange):
            """Cancel using another verified HTTP transaction before returning usage."""
            cancelled = self.post('/preparazioni/'+workspace+'/lavori/'+job+'/annulla',{'request_key':str(uuid4())})
            self.assertEqual(cancelled.status_code,200,cancelled.text)
            return self.response(exchange)
        self.assertEqual(self.worker(response).run_once()['state'],'cancelled')
        state,output,usage = self.owner.execute('SELECT state,output,usage FROM preparation.jobs WHERE id=%s',(job,)).fetchone()
        self.assertEqual(state,'cancelled')
        self.assertIsNone(output)
        self.assertEqual(usage['input_tokens'],100)

    def test_known_local_refusal_releases_the_reservation(self):
        """Input-limit rejection makes no transport call and settles a known zero."""
        workspace,input_id = self.prepare()
        job = self.enqueue(workspace,input_id)
        calls = []
        self.assertEqual(self.worker(lambda r:calls.append(r),max_input=1).run_once()['state'],'failed')
        self.assertEqual(calls,[])
        self.assertEqual(self.owner.execute('SELECT state,settled_microusd FROM preparation.budget_reservations WHERE job_id=%s',(job,)).fetchone(),('settled',0))

    def test_heartbeat_and_restart_keep_single_dispatch(self):
        """Renewals are separate; restart recovers leases but never a paid dispatch."""
        workspace,input_id = self.prepare()
        job = self.enqueue(workspace,input_id)
        leased = self.queue.claim(uuid4())
        self.owner.execute("UPDATE preparation.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s",(job,))
        pulsed = Event()
        original = self.queue.heartbeat

        def heartbeat(claim,dispatch):
            """Observe one actual database renewal from the provider's blocked interval."""
            value = original(claim,dispatch)
            if value:
                pulsed.set()
            return value
        self.queue.heartbeat = heartbeat

        def response(exchange):
            """Hold the controlled response until the independent heartbeat commits."""
            self.assertTrue(pulsed.wait(3))
            return self.response(exchange)
        self.assertEqual(self.worker(response,interval=.01).run_once()['state'],'succeeded')
        workspace,input_id = self.prepare()
        job = self.enqueue(workspace,input_id)
        abandoned = self.queue.claim(uuid4())
        dispatched = self.queue.start(abandoned)
        self.owner.execute("UPDATE preparation.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=%s",(job,))
        calls = []
        self.assertIsNone(self.worker(lambda r:calls.append(r)).run_once())
        self.assertEqual(calls,[])
        self.assertEqual(self.owner.execute('SELECT state FROM preparation.jobs WHERE id=%s',(job,)).fetchone()[0],'uncertain')
        req = build_request(abandoned)
        known = {'input_tokens':50,'output_tokens':10,'cached_input_tokens':0,'reasoning_tokens':0}
        completed = result(req)
        self.assertEqual(self.queue.finish(abandoned,dispatched['dispatch_id'],completed,known)['state'],'succeeded')
        self.assertEqual(self.queue.finish(abandoned,dispatched['dispatch_id'],completed,known)['state'],'succeeded')

    def test_v2_literal_facts_survive_worker_http_edit_and_selective_moderation(self):
        """Use real worker/DB/HTTP boundaries while all provider I/O stays mocked."""
        self.owner.execute('INSERT INTO preparation.ai_configurations(version,provider_config,max_input_tokens,max_output_tokens,input_rate_microusd_per_million,cached_rate_microusd_per_million,output_rate_microusd_per_million,verified_at,price_reference) VALUES(%s,%s,300000,2000,1000000,500000,1000000,clock_timestamp(),%s)',
            ('fixture/facts-2',Jsonb({**CONFIG,'interpretation_version':2}),'Synthetic v2; no provider'))
        self.owner.execute("UPDATE preparation.ai_settings SET config_version='fixture/facts-2'")
        self.addCleanup(self.owner.execute,"UPDATE preparation.ai_settings SET config_version='fixture/1'")
        workspace,input_id = self.prepare('Sportello. Ente: Associazione Alfa. Categoria: Mensa. NOTA NON SELEZIONATA')
        canonical_before = self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0]
        job = self.enqueue(workspace,input_id)
        calls = []

        def response(exchange):
            """Return literal claims and their exact passages in a single fake exchange."""
            body = json.loads(exchange.content)
            req = json.loads(body['input'][0]['content'][0]['text'])
            self.assertEqual(req['schema_version'],2)
            calls.append(req)
            value = result(req)
            proposed = value['candidates'][0]
            proposed['service']['name'] = 'Sportello'
            proposed['evidence'][0].update(quote='Sportello',span={'start':0,'end':9})
            for index,(kind,label) in enumerate((('organization_name','Associazione Alfa'),('category_label','Mensa'))):
                proposed['source_facts'].append({'fact_key':str(index),'subject':'service','kind':kind,'source_value':label})
                start = req['text'].index(label)
                proposed['evidence'].append({'id':str(uuid4()),'path':f'/source_facts/{index}/source_value','input_id':input_id,
                    'input_hash':req['input_hash'],'kind':'stated','quote':label,'span':{'start':start,'end':start+len(label)}})
            return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant',
                'content':[{'type':'output_text','text':json.dumps(value)}]}],'usage':{'input_tokens':100,'output_tokens':20}})
        self.assertEqual(self.worker(response).run_once()['state'],'succeeded')
        self.assertEqual(len(calls),1)
        ids = self.client.get(BASE+f'/preparazioni/{workspace}/lavori/{job}').json()['candidate_ids']
        created = self.post(f'/preparazioni/{workspace}/schede/crea',{'input_id':input_id,'job_id':job,
            'selections':[{'candidate_id':ids['one']}],'request_key':str(uuid4())})
        self.assertEqual(created.status_code,201,created.text)
        card = created.json()['items'][0]
        path = f'/preparazioni/{workspace}/schede/{card["item_id"]}'
        version = self.client.get(BASE+path).json()['version']
        payload = version['payload']
        self.assertEqual(payload['schema_version'],2)
        self.assertEqual(payload['source_facts'][0]['source_value'],'Associazione Alfa')
        self.assertNotIn('organizations',payload['service'])
        payload['source_facts'][0]['value'] = 'Associazione Alfa corretta'
        payload['field_origins']['/source_facts/0/value'] = {'state':'manual'}
        payload['outcome'] = 'confirmed'
        saved = self.post(f'/preparazioni/{workspace}/schede',{'changes':[{'item_id':card['item_id'],
            'expected_version':version['id'],'payload':payload}],'request_key':str(uuid4())})
        self.assertEqual(saved.status_code,200,saved.text)
        current = saved.json()['items'][0]['after']
        reopened = self.client.get(BASE+path).json()['version']['payload']
        self.assertEqual(reopened['source_facts'][0]['value'],'Associazione Alfa corretta')
        self.assertEqual(reopened['source_facts'][0]['source_value'],'Associazione Alfa')
        legacy = {key:value for key,value in deepcopy(payload).items() if key not in ('source_facts','resolutions')}
        legacy['schema_version'] = 1
        legacy['field_origins'] = {key:value for key,value in legacy['field_origins'].items() if not key.startswith('/source_facts/')}
        legacy['evidence'] = [value for value in legacy['evidence'] if not value['path'].startswith('/source_facts/')]
        old_client = self.post(f'/preparazioni/{workspace}/schede',{'changes':[{'item_id':card['item_id'],
            'expected_version':current,'payload':legacy}],'request_key':str(uuid4())})
        self.assertEqual(old_client.status_code,409,old_client.text)
        sent = self.post(f'/preparazioni/{workspace}/invii',{'items':[{'item_id':card['item_id'],'expected_version':current}],
            'request_key':str(uuid4())})
        self.assertEqual(sent.status_code,200,sent.text)
        contribution = sent.json()['items'][0]['receipt']['contribution_id']
        page = self.client.get('/moderazione/contributo/'+contribution)
        self.assertEqual(page.status_code,200,page.text)
        self.assertIn('Associazione Alfa corretta',page.text)
        self.assertNotIn('NOTA NON SELEZIONATA',page.text)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0],canonical_before)

    def test_public_context_matches_cross_one_worker_exchange_and_materialize_unconfirmed(self):
        """The pinned wheel, real HTTP catalog and DB worker agree on the context digest."""
        from datetime import date
        from review.matching import make_context, propose
        workspace,input_id = self.prepare('Istruzione')
        catalog = self.post('/preparazioni/'+workspace+'/catalogo', {'query':{'kind':'taxonomy_context'}})
        self.assertEqual(catalog.status_code,200,catalog.text)
        scope = catalog.json()['entries'][0]
        page = self.post('/preparazioni/'+workspace+'/catalogo', {'query':{'kind':'classification','territory_id':scope['territory_id'],'axis_id':scope['axis_id']}}).json()
        context = make_context(page,as_of=date.fromisoformat(page['as_of']))
        config = {**CONFIG,'interpretation_version':2,'catalog_context':context}
        self.owner.execute('INSERT INTO preparation.ai_configurations(version,provider_config,max_input_tokens,max_output_tokens,input_rate_microusd_per_million,cached_rate_microusd_per_million,output_rate_microusd_per_million,verified_at,price_reference) VALUES(%s,%s,300000,2000,1000000,500000,1000000,clock_timestamp(),%s)',
            ('fixture/matches-2',Jsonb(config),'Synthetic public catalog; no provider'))
        self.owner.execute("UPDATE preparation.ai_settings SET config_version='fixture/matches-2'")
        self.addCleanup(self.owner.execute,"UPDATE preparation.ai_settings SET config_version='fixture/1'")
        job = self.enqueue(workspace,input_id)
        calls = []

        def response(exchange):
            """Return a bounded supplied-key proposal in the existing extraction response."""
            body = json.loads(exchange.content)
            req = json.loads(body['input'][0]['content'][0]['text'])
            self.assertEqual(req['catalog_context']['digest'],context['digest'])
            calls.append(req)
            value = result(req)
            card = value['candidates'][0]
            card['source_facts'] = [{'fact_key':'category','subject':'service','kind':'category_label','source_value':'Istruzione'}]
            card['evidence'].append({**card['evidence'][0],'id':str(uuid4()),'path':'/source_facts/0/source_value'})
            card['matches'] = propose(card['source_facts'],context)
            return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(value)}]}],
                                          'usage':{'input_tokens':100,'output_tokens':20}})
        self.assertEqual(self.worker(response).run_once()['state'],'succeeded')
        self.assertEqual(len(calls),1)
        candidate = self.client.get(BASE+'/preparazioni/'+workspace+'/lavori/'+job).json()['candidate_ids']['one']
        selected = self.post('/preparazioni/'+workspace+'/schede/crea', {'input_id':input_id,'job_id':job,'selections':[{'candidate_id':candidate}],'request_key':str(uuid4())})
        self.assertEqual(selected.status_code,201,selected.text)
        item = selected.json()['items'][0]
        payload = self.client.get(BASE+'/preparazioni/'+workspace+'/schede/'+item['item_id']).json()['version']['payload']
        resolution = payload['resolutions'][0]
        self.assertEqual(resolution['state'],'proposed')
        self.assertEqual(resolution['fact_id'],payload['source_facts'][0]['fact_id'])
        self.assertNotIn('selected',resolution)
        self.assertFalse(payload['service'].get('classifications'))
        self.assertEqual(resolution['candidates'][0]['target'],context['entries'][0]['target'])
