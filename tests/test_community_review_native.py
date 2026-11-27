"""Real HTTP/native Community snapshot acceptance, separate publication and identity."""
from copy import deepcopy
import getpass
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
import psycopg

from app.backend.api.moderation import auth
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, DirectorySettings, EditorialSettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster, people

BASE='/moderazione/contribuisci/api'
ROOT=Path(__file__).resolve().parents[1]
SECRET='r'*40


@unittest.skipUnless(REPOSITORY,'needs explicit EGI_DATABASE_REPO native schema fixture')
class CommunityReviewTests(unittest.TestCase):
    """Prove the actual submitted-card to published-service path without provider I/O."""

    @classmethod
    def setUpClass(cls):
        """Deploy disposable schema, reader/editorial logins and real test sessions."""
        cls.cluster=Cluster.__new__(Cluster)
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.__init__(65460,'egi_community_review')
        cls.cluster.file(Path(REPOSITORY)/'tests/contract/fixtures.sql',Path(REPOSITORY)/'tests/contract/helpers.sql',ROOT/'tests/canonical-fixture.sql')
        cls.cluster.sql('CREATE ROLE egi_community_review_desk LOGIN IN ROLE egi_editorial')
        cls.people=people(cls.cluster,'egi_community_review_desk')
        cls.owner=psycopg.connect(cls.cluster.dsn(getpass.getuser()),autocommit=True)
        cls.addClassCleanup(cls.owner.close)
        errors=tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        cls.app=create_app(Configuration(profile(),canonical=True,error_dir=Path(errors.name),
            directory=DirectorySettings(database_url=cls.cluster.dsn('egi_app_test_reader')),
            editorial=EditorialSettings(database_url=cls.cluster.dsn('egi_community_review_desk'),cookie_secret=SECRET,secure_cookie=False)),{'source':StaticSubjectSource([])})

    def browser(self,login):
        """Return a browser with the actual role/session stored by PostgreSQL."""
        client=TestClient(self.app)
        client.__enter__()
        self.addCleanup(client.__exit__,None,None,None)
        client.cookies.set('egi_moderation',login,path='/moderazione')
        return client

    def headers(self,login):
        """Use the same Origin and per-session form-token algorithm as the browser."""
        return {'origin':'http://testserver','X-EGI-Form-Token':auth.form_token(SECRET,auth.token_hash(login))}

    def post(self,client,path,body,login='mod1'):
        """POST a versioned JSON request as the named verified role."""
        return client.post(path,json=body,headers=self.headers(login))

    def form(self,client,path,**body):
        """Reuse canonical approve/publish and generic closure forms as Admin."""
        return client.post(path,data={**body,'form_token':auth.form_token(SECRET,auth.token_hash('admin'))},headers={'origin':'http://testserver'},follow_redirects=False)

    def test_selective_snapshot_edited_acceptance_publication_and_linked_update(self):
        """Private siblings stay hidden; accepted versions retain one canonical identity."""
        contributor,admin=self.browser('mod1'),self.browser('admin')
        source=self.post(contributor,BASE+'/fonti',{'metadata':{'name':'Review test source','source_kind':'directory'},'request_key':str(uuid4())}).json()['source_id']
        workspace=self.post(contributor,BASE+'/preparazioni',{'source_id':source,'title':'Selective test','request_key':str(uuid4())}).json()['id']
        raw='Sportello telefono 0612345678\nPRIVATE SIBLING NOTE'
        uploaded=contributor.post(f'{BASE}/preparazioni/{workspace}/input',content=raw.encode(),headers={**self.headers('mod1'),'Content-Type':'text/plain; charset=utf-8','X-EGI-Expected-Revision':'1','X-EGI-Public-Material':'false','X-EGI-Request-Key':str(uuid4())}).json()
        input_id=uploaded['input_id']
        created=self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede/crea',{'input_id':input_id,'job_id':None,'selections':[{'creation_key':str(uuid4())}],'request_key':str(uuid4())}).json()['items'][0]
        item=created['item_id']
        payload=contributor.get(f'{BASE}/preparazioni/{workspace}/schede/{item}').json()['version']['payload']
        payload.update(service={'name':'Sportello','description':'telefono','delivery_mode':'telephone','contacts':[{'channel_type':'phone','value':'0612345678','is_public':True}]},outcome='confirmed')
        payload['evidence']=[]
        for path,quote,kind in (('/service/name','Sportello','stated'),('/service/description','telefono','stated'),('/service/delivery_mode','telefono','interpreted'),('/service/contacts/0','0612345678','stated')):
            start=raw.index(quote)
            payload['evidence'].append({'id':str(uuid4()),'path':path,'input_id':input_id,'input_hash':uploaded['input_hash'],'kind':kind,'quote':quote,'span':{'start':start,'end':start+len(quote)}})
        saved=self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede',{'changes':[{'item_id':item,'expected_version':created['version_id'],'payload':payload}],'request_key':str(uuid4())})
        self.assertEqual(saved.status_code,200,saved.text)
        version=saved.json()['items'][0]['after']
        sibling=self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede/crea',{'input_id':input_id,'job_id':None,'selections':[{'creation_key':str(uuid4())}],'request_key':str(uuid4())}).json()['items'][0]
        key=str(uuid4())
        submission={'request_key':key,'items':[{'item_id':item,'expected_version':version},{'item_id':sibling['item_id'],'expected_version':sibling['version_id']}]}
        sent=self.post(contributor,f'{BASE}/preparazioni/{workspace}/invii',submission)
        self.assertEqual(sent.status_code,200,sent.text)
        self.assertEqual([value['outcome'] for value in sent.json()['items']],['submitted','excluded'])
        contribution=sent.json()['items'][0]['receipt']['contribution_id']
        replay=self.post(contributor,f'{BASE}/preparazioni/{workspace}/invii',submission)
        self.assertEqual(replay.json()['items'][0]['receipt']['contribution_id'],contribution)
        self.assertEqual(admin.get(f'{BASE}/preparazioni/{workspace}').status_code,404)
        detail=admin.get('/moderazione/contributo/'+contribution)
        self.assertEqual(detail.status_code,200,detail.text[:500])
        self.assertIn('community-review-context',detail.text)
        self.assertNotIn('PRIVATE SIBLING NOTE',detail.text)
        self.assertNotIn('original_base64',detail.text)
        self.assertIn('Mod One',detail.text)
        self.assertEqual(self.owner.execute('SELECT submitted_by::text FROM editorial.community_snapshots WHERE contribution_id=%s',(contribution,)).fetchone()[0],self.people['mod1']['actor'])
        evidence=[entry['id'] for entry in payload['evidence']]
        decision={'schema_version':1,'expected_service_work':None,'expected_service_public':None,
            'service_operations':[{'op':'add','path':'/name','value':'Sportello','evidence_ids':evidence}],
            'location':{'kind':'none'},'reason':'Synthetic source review','observations':[]}
        endpoint='/moderazione/contributo/'+contribution+'/accetta-community'
        count=self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0]
        incomplete=self.post(admin,endpoint,{'request_key':str(uuid4()),'decision':decision},'admin')
        self.assertEqual(incomplete.status_code,422,incomplete.text)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0],count)
        territory=self.owner.execute('SELECT entity_id::text FROM geo.territories LIMIT 1').fetchone()[0]
        decision['service_operations']=[{'op':'add','path':'/'+field,'value':value,'evidence_ids':evidence} for field,value in payload['service'].items()]
        decision['service_operations'][0]['value']='Sportello verificato'
        decision['service_operations'].append({'op':'add','path':'/territories','value':[territory],'evidence_ids':[]})
        decision['observations']=[{'paths':['/service/name','/service/territories'],'method':'phone_call','note':'Synthetic verification'}]
        accepted=self.post(admin,endpoint,{'request_key':str(uuid4()),'decision':decision},'admin')
        self.assertEqual(accepted.status_code,200,accepted.text)
        service,revision=accepted.json()['service_id'],accepted.json()['initial_revision_id']
        self.assertIsNone(self.owner.execute('SELECT revision_id FROM governance.published_heads WHERE entity_id=%s',(service,)).fetchone())
        linked=admin.get('/moderazione/contributo/'+contribution)
        self.assertIn('Proposta accettata',linked.text)
        self.assertNotIn('id="community-accept-form"',linked.text)
        publish_path='/moderazione/servizio/'+service+'/pubblica'
        blocked=self.form(admin,publish_path,working=revision,public='',summary='Synthetic publish')
        self.assertEqual(blocked.status_code,400)
        self.assertIn('una o più fonti usate nelle evidenze',blocked.text)
        wrong_source=self.post(admin,BASE+'/fonti',{'metadata':{'name':'Unrelated source','source_kind':'directory'},'request_key':str(uuid4())},'admin').json()['source_id']
        self.assertEqual(self.post(admin,BASE+'/fonti/'+wrong_source+'/ammetti',{'reason':'Different source'},'admin').status_code,200)
        self.assertEqual(self.form(admin,publish_path,working=revision,public='',summary='Still blocked').status_code,400)
        editorial=self.owner.execute("SELECT source_id::text FROM sources.registry WHERE code='egi_editorial'").fetchone()[0]
        for selected in (source,editorial):
            self.assertEqual(self.post(admin,BASE+'/fonti/'+selected+'/ammetti',{'reason':'Synthetic source admission'},'admin').status_code,200)
        published=self.form(admin,publish_path,working=revision,public='',summary='Reviewed and admitted')
        self.assertEqual(published.status_code,303,published.text[:500])
        public=admin.get('/api/public/services/'+service)
        self.assertEqual(public.status_code,200,public.text)
        self.assertIn('Sportello verificato',public.text)
        self.assertNotIn('PRIVATE SIBLING NOTE',public.text)
        wrong_publication=self.owner.execute('SELECT publication_id::text FROM governance.published_heads h JOIN data.services s USING(entity_id) WHERE entity_id<>%s LIMIT 1',(service,)).fetchone()[0]
        closure='/moderazione/contributo/'+contribution+'/chiudi'
        self.assertEqual(self.form(admin,closure,outcome='published',publication=wrong_publication).status_code,400)
        publication=self.owner.execute('SELECT publication_id::text FROM governance.published_heads WHERE entity_id=%s',(service,)).fetchone()[0]
        self.assertEqual(self.form(admin,closure,outcome='published',publication=publication).status_code,303)
        update=deepcopy(payload)
        update['service']['name']='Seconda versione'
        update['evidence']=[entry for entry in update['evidence'] if entry['path']!='/service/name']
        newer=self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede',{'changes':[{'item_id':item,'expected_version':version,'payload':update}],'request_key':str(uuid4())})
        next_version=newer.json()['items'][0]['after']
        conflict=self.post(contributor,f'{BASE}/preparazioni/{workspace}/invii',{'request_key':key,'items':[{'item_id':item,'expected_version':next_version}]})
        self.assertEqual(conflict.status_code,409,conflict.text)
        self.assertIn('request_id',conflict.json())
        updated=self.post(contributor,f'{BASE}/preparazioni/{workspace}/invii',{'request_key':str(uuid4()),'items':[{'item_id':item,'expected_version':next_version}]})
        next_contribution=updated.json()['items'][0]['receipt']['contribution_id']
        old_contacts=self.owner.execute('SELECT editorial.revision_body(%s)',(revision,)).fetchone()[0]['contacts']
        next_decision={'schema_version':1,'expected_service_work':revision,'expected_service_public':revision,
            'service_operations':[{'op':'replace','path':'/name','value':'Seconda versione','evidence_ids':[]}],
            'location':{'kind':'none'},'reason':'Versioned update','observations':[{'paths':['/service/name'],'method':'document'}]}
        accepted_next=self.post(admin,'/moderazione/contributo/'+next_contribution+'/accetta-community',{'decision':next_decision,'request_key':str(uuid4())},'admin')
        self.assertEqual(accepted_next.status_code,200,accepted_next.text)
        self.assertEqual(accepted_next.json()['service_id'],service)
        self.assertEqual(self.owner.execute('SELECT count(*) FROM data.services').fetchone()[0],count+1)
        contacts=self.owner.execute('SELECT editorial.revision_body(%s)',(accepted_next.json()['initial_revision_id'],)).fetchone()[0]['contacts']
        self.assertEqual(contacts,old_contacts)
        self.assertEqual(admin.get(f'{BASE}/preparazioni/{workspace}/input/{input_id}').status_code,404)
