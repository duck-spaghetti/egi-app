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

    def test_entity_category_acceptance_and_explicit_organization_publication(self):
        """Keep an unresolved name; link an existing entity and create/publish one draft."""
        from psycopg.types.json import Jsonb
        contributor, admin = self.browser('mod1'), self.browser('admin')
        evidence = {'record':[{'assertion_id':'57000000-0000-0000-0000-000000000001','role':'supporting'}]}
        existing_rev = self.owner.execute("SELECT governance.save_revision('organization',NULL,NULL,NULL,%s,'Existing partner fixture')",(Jsonb({'name':'Partner esistente','original_language':'it','evidence':evidence}),)).fetchone()[0]
        reviewed = self.owner.execute("SELECT governance.review_revision(%s,NULL,'approved','Existing partner fixture')",(existing_rev,)).fetchone()[0]
        self.owner.execute('SELECT governance.publish_revision(%s,%s,NULL)',(existing_rev,reviewed))
        initial_orgs = self.owner.execute('SELECT count(*) FROM data.organizations').fetchone()[0]
        source = self.post(contributor,BASE+'/fonti',{'metadata':{'name':'Entity review source','source_kind':'directory'},'request_key':str(uuid4())}).json()['source_id']
        workspace = self.post(contributor,BASE+'/preparazioni',{'source_id':source,'title':'Entity integration','request_key':str(uuid4())}).json()['id']
        raw = 'Mensa\nAssociazione Alfa\nPartner esistente\nAssociazione Zeta\nIstruzione\nPRIVATE UNSENT NOTE'
        upload = contributor.post(f'{BASE}/preparazioni/{workspace}/input',content=raw.encode(),headers={**self.headers('mod1'),'Content-Type':'text/plain; charset=utf-8','X-EGI-Expected-Revision':'1','X-EGI-Public-Material':'false','X-EGI-Request-Key':str(uuid4())})
        self.assertEqual(upload.status_code,201,upload.text)
        input_id = upload.json()['input_id']
        created = self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede/crea',{'input_id':input_id,'job_id':None,'selections':[{'creation_key':str(uuid4())}],'request_key':str(uuid4())}).json()['items'][0]
        item_path = f'{BASE}/preparazioni/{workspace}/schede/{created["item_id"]}'
        payload = contributor.get(item_path).json()['version']['payload']
        contexts = self.post(contributor,f'{BASE}/preparazioni/{workspace}/catalogo',{'query':{'kind':'taxonomy_context'}}).json()['entries']
        scope = contexts[0]
        payload.update(schema_version=2,source_facts=[],resolutions=[],outcome='confirmed',service={'name':'Mensa','description':'Informazioni sui pasti','delivery_mode':'telephone',
            'territories':[scope['territory_id']],'contacts':[{'channel_type':'phone','value':'0612345678','is_public':True}]})
        for kind,value in (('organization_name','Associazione Alfa'),('organization_name','Partner esistente'),('organization_name','Associazione Zeta'),('category_label','Istruzione')):
            start = raw.index(value)
            fragment = self.post(contributor,item_path+'/fatto-preparato',{'input_id':input_id,'kind':kind,'subject':'service','selection':{'start':start,'end':start+len(value)}})
            self.assertEqual(fragment.status_code,200,fragment.text)
            fragment = fragment.json();index = len(payload['source_facts'])
            payload['source_facts'].append(fragment['fact'])
            payload['evidence'].append({**fragment['evidence'],'path':f'/source_facts/{index}/source_value'})
            payload['field_origins'].update({key.replace('/source_facts/0/',f'/source_facts/{index}/'):value for key,value in fragment['field_origins'].items()})
        saved = self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede',{'changes':[{'item_id':created['item_id'],'expected_version':created['version_id'],'payload':payload}],'request_key':str(uuid4())})
        self.assertEqual(saved.status_code,200,saved.text)
        version = saved.json()['items'][0]['after']
        proposed = self.post(contributor,item_path+'/suggerimenti',{'expected_version':version,'fact_id':payload['source_facts'][3]['fact_id'],
            'query':{'kind':'classification','territory_id':scope['territory_id'],'axis_id':scope['axis_id']}})
        self.assertEqual(proposed.status_code,200,proposed.text)
        category = proposed.json()['resolution']
        existing = self.post(contributor,f'{BASE}/preparazioni/{workspace}/catalogo',{'query':{'kind':'organization','search':'Partner esistente'}}).json()['entries'][0]['target']
        lookup = self.post(contributor,f'{BASE}/preparazioni/{workspace}/catalogo',{'query':{'kind':'organization','organization_ids':[existing['organization_id']]}})
        self.assertEqual(lookup.status_code,200,lookup.text)
        self.assertEqual([entry['label'] for entry in lookup.json()['entries']],['Partner esistente'])
        self.assertEqual(self.post(contributor,f'{BASE}/preparazioni/{workspace}/catalogo',{'query':{'kind':'organization','organization_ids':[str(uuid4()) for _ in range(101)]}}).status_code,422)
        new_context = self.post(contributor,f'{BASE}/preparazioni/{workspace}/catalogo',{'query':{'kind':'organization','search':'Associazione Alfa'}}).json()['context']
        payload['resolutions'] = [
            {'fact_id':payload['source_facts'][0]['fact_id'],'state':'confirmed','context':new_context,'candidates':[],
             'selected':{'target':{'kind':'new_organization','body':{'name':'Associazione Alfa','original_language':'it','territories':[]}},'role':'provider'}},
            {'fact_id':payload['source_facts'][1]['fact_id'],'state':'confirmed','context':{},'candidates':[],'selected':{'target':existing,'role':'organizer'}},
            {'fact_id':payload['source_facts'][3]['fact_id'],'state':'confirmed','context':category['context'],'candidates':[],'selected':{'target':category['candidates'][0]['target']}}]
        saved = self.post(contributor,f'{BASE}/preparazioni/{workspace}/schede',{'changes':[{'item_id':created['item_id'],'expected_version':version,'payload':payload}],'request_key':str(uuid4())})
        self.assertEqual(saved.status_code,200,saved.text)
        version = saved.json()['items'][0]['after']
        sent = self.post(contributor,f'{BASE}/preparazioni/{workspace}/invii',{'items':[{'item_id':created['item_id'],'expected_version':version}],'request_key':str(uuid4())})
        self.assertEqual(sent.status_code,200,sent.text)
        contribution = sent.json()['items'][0]['receipt']['contribution_id']
        review_path = '/moderazione/contributo/'+contribution
        page = admin.get(review_path)
        self.assertEqual(page.status_code,200,page.text[:600])
        self.assertIn('Associazione Zeta',page.text)
        self.assertNotIn('PRIVATE UNSENT NOTE',page.text)
        self.assertEqual(admin.get(item_path).status_code,404)
        actions = [{'fact_id':r['fact_id'],'action':'create' if r['selected']['target']['kind']=='new_organization' else 'select',
                    'context':r['context'],'selected':r['selected'],'note':'Checked identity, role and category','reconcile':'retain'} for r in payload['resolutions']]
        actions.append({'fact_id':payload['source_facts'][2]['fact_id'],'action':'keep'})
        decision = {'schema_version':2,'expected_service_work':None,'expected_service_public':None,
            'service_operations':[{'op':'add','path':'/'+key,'value':value,'evidence_ids':[]} for key,value in payload['service'].items()],
            'location':{'kind':'none'},'reason':'Explicit entity/category review','observations':[{'paths':['/service'],'method':'document','note':'Synthetic service check'}],'fact_actions':actions}
        request = {'decision':decision,'request_key':str(uuid4())}
        accepted = self.post(admin,review_path+'/accetta-community',request,'admin')
        self.assertEqual(accepted.status_code,200,accepted.text)
        self.assertEqual(self.post(admin,review_path+'/accetta-community',request,'admin').json()['initial_revision_id'],accepted.json()['initial_revision_id'])
        self.assertEqual(self.owner.execute('SELECT count(*) FROM data.organizations').fetchone()[0],initial_orgs+1)
        service,revision = accepted.json()['service_id'],accepted.json()['initial_revision_id']
        canonical = self.owner.execute('SELECT editorial.revision_body(%s)',(revision,)).fetchone()[0]
        self.assertEqual({o['role_code'] for o in canonical['organizations']},{'provider','organizer'})
        organization = next(o for o in canonical['organizations'] if o['role_code']=='provider')['organization_id']
        org_revision = str(self.owner.execute('SELECT revision_id FROM governance.working_heads WHERE entity_id=%s',(organization,)).fetchone()[0])
        page = admin.get(review_path)
        self.assertEqual(page.status_code,200,page.text[:600])
        self.assertIn('Approva e pubblica ente',page.text)
        publication_body = {'expected_work':org_revision,'expected_public':None,'reason':'Explicit organization approval/publication'}
        publish_org = review_path+'/enti/'+organization+'/pubblica'
        blocked = self.post(admin,publish_org,publication_body,'admin')
        self.assertEqual(blocked.status_code,422,blocked.text)
        editorial = self.owner.execute("SELECT source_id::text FROM sources.registry WHERE code='egi_editorial'").fetchone()[0]
        for selected in (source,editorial):
            self.assertEqual(self.post(admin,BASE+'/fonti/'+selected+'/ammetti',{'reason':'Checked fixture source'},'admin').status_code,200)
        publish_service = '/moderazione/servizio/'+service+'/pubblica'
        self.assertEqual(self.form(admin,publish_service,working=revision,public='',summary='Organization still draft').status_code,400)
        self.assertEqual(self.post(admin,review_path+'/enti/'+str(uuid4())+'/pubblica',publication_body,'admin').status_code,404)
        published = self.post(admin,publish_org,publication_body,'admin')
        self.assertEqual(published.status_code,200,published.text)
        self.assertTrue(self.post(admin,publish_org,publication_body,'admin').json()['already_published'])
        self.assertIsNone(self.owner.execute('SELECT revision_id FROM governance.published_heads WHERE entity_id=%s',(service,)).fetchone())
        self.assertEqual(self.form(admin,publish_service,working=revision,public='',summary='Explicit service publication').status_code,303)
        public = admin.get('/api/public/services/'+service)
        self.assertEqual(public.status_code,200,public.text)
        canonical_public = self.owner.execute('SELECT api.service_detail(%s)',(service,)).fetchone()[0]
        self.assertEqual({item['name']['text'] for item in canonical_public['organizations']},{'Associazione Alfa','Partner esistente'})
        self.assertEqual({item['role'] for item in canonical_public['organizations']},{'provider','organizer'})
        self.assertNotIn('Associazione Zeta',public.text)
        self.assertNotIn('PRIVATE UNSENT NOTE',public.text)
