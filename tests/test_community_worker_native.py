"""Durable worker/native HTTP contracts with controlled provider exchanges only."""
import getpass
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
