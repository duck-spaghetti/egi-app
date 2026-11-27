"""Synthetic public input/configuration fixtures; these never authorize live calls."""
import hashlib
from uuid import uuid4


CONFIG = {'provider':'openai','api':'responses','model':'fixture-model','store':False,
          'live_authorized':True,'fixture_only':True,'language_version':'fixture-languages/1','taxonomy_version':'fixture-taxonomy/1'}


def request(text='Sportello') -> dict:
    """Make a versioned Unicode-preserving request without real source/account data."""
    return {'schema_version':1,'task':'extract_text','input_id':str(uuid4()),
        'input_hash':hashlib.sha256(text.encode()).hexdigest(),'config_version':'fixture/1',
        'text':text,'source_metadata':{'name':'Synthetic public source'},
        'locator_map':{'kind':'identity_with_redactions','redactions':[]},
        'field_dictionary_version':'egi-preparation-fields/1','language_version':'fixture-languages/1',
        'taxonomy_version':'fixture-taxonomy/1','requested_output_shape':'interpretation.result.v1'}


def result(req: dict) -> dict:
    """Propose one exact name under the requested explicit fixture protocol."""
    value = {'schema_version':req['schema_version'],'input_id':req['input_id'],'input_hash':req['input_hash'],
        'config_version':req['config_version'],'state':'complete','mapping':None,'diagnostics':[],
        'candidates':[{'candidate_key':'one','service':{'name':req['text']},'location':{'kind':'none'},
            'diagnostics':[],'evidence':[{'id':str(uuid4()),'path':'/service/name','input_id':req['input_id'],
                'input_hash':req['input_hash'],'kind':'stated','quote':req['text'],'span':{'start':0,'end':len(req['text'])}}]}]}
    if req['schema_version'] == 2:
        value['candidates'][0]['source_facts'] = []
    return value
