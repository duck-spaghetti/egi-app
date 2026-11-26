"""One bounded OpenAI Responses exchange through the existing httpx dependency.

OpenAIAdapter retains accounting separately from semantic validation. It exposes no
external tools, follows no redirects, stores no response at the provider, and never
retries. Unknown transport/usage outcomes stay uncertain for durable accounting.
"""
import json
import re

import httpx
from pydantic import SecretStr
from review.insertion import INSTRUCTIONS

from .schema import clean_result, output_schema

ENDPOINT = 'https://api.openai.com/v1/responses'
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
CONFIG_KEYS = {'provider', 'api', 'model', 'store', 'live_authorized', 'language_version',
               'taxonomy_version', 'timeout_seconds', 'reasoning_effort', 'fixture_only'}


class ConfigurationError(ValueError):
    """Refuse missing authorization/configuration before any provider request."""


def validate_config(config: dict) -> dict:
    """Require explicit model/data settings and a separate scoped live-dispatch grant."""
    required = {'provider','api','model','store','live_authorized','language_version','taxonomy_version'}
    if not isinstance(config, dict) or config.keys() - CONFIG_KEYS or not required <= config.keys():
        raise ConfigurationError('invalid_provider_configuration')
    if config['provider'] != 'openai' or config['api'] != 'responses' or config['store'] is not False or config['live_authorized'] is not True:
        raise ConfigurationError('provider_not_authorized')
    if not isinstance(config['model'], str) or not re.fullmatch(r'[a-zA-Z0-9._:-]{1,120}', config['model']):
        raise ConfigurationError('invalid_provider_model')
    for key in ('language_version','taxonomy_version'):
        if not isinstance(config[key], str) or not 1 <= len(config[key]) <= 100:
            raise ConfigurationError('invalid_provider_configuration')
    if 'fixture_only' in config and type(config['fixture_only']) is not bool:
        raise ConfigurationError('invalid_provider_configuration')
    timeout = config.get('timeout_seconds', 120)
    if type(timeout) not in (int,float) or not 5 <= timeout <= 300:
        raise ConfigurationError('invalid_provider_timeout')
    if config.get('reasoning_effort') not in (None,'none','minimal','low','medium','high','xhigh','max'):
        raise ConfigurationError('invalid_provider_reasoning')
    return dict(config)


class OpenAIAdapter:
    """Keep one exchange's safe outcome and usage for its owning worker instance."""

    def __init__(self, config: dict, api_key: SecretStr, max_input: int, max_output: int, transport=None):
        """Validate frozen limits/settings; inject a transport only for controlled tests."""
        self.config = validate_config(config)
        if self.config.get('fixture_only') and not isinstance(transport,httpx.MockTransport):
            raise ConfigurationError('fixture_provider_requires_mock_transport')
        if not isinstance(api_key, SecretStr) or not api_key.get_secret_value() or type(max_input) is not int or type(max_output) is not int or min(max_input,max_output) <= 0:
            raise ConfigurationError('invalid_provider_configuration')
        self.api_key, self.max_input, self.max_output = api_key, max_input, max_output
        self.transport = transport
        self.response = None
        self.called = False

    def __call__(self, request: dict) -> dict:
        """Dispatch once, retaining safe usage even if the proposal cannot validate."""
        if self.called:
            raise ConfigurationError('provider_already_called')
        self.called = True
        schema = output_schema(request)
        payload = {'model':self.config['model'], 'store':False, 'stream':False,
            'instructions':INSTRUCTIONS + '\nUse null for absent optional facts. Emit valid JSON matching the supplied schema.',
            'input':[{'role':'user','content':[{'type':'input_text','text':json.dumps(request,ensure_ascii=False,allow_nan=False)}]}],
            'text':{'format':{'type':'json_schema','name':'egi_interpretation','strict':True,'schema':schema}},
            'max_output_tokens':self.max_output}
        if self.config.get('reasoning_effort'):
            payload['reasoning'] = {'effort':self.config['reasoning_effort']}
        # Byte-level fallback tokens plus an explicit framing margin bound the
        # selected modern tokenizer conservatively; settlement checks actual usage.
        if len(json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()) + 1024 > self.max_input:
            self.response = self.failure('context_limit', known_zero=True)
            return self.response
        timeout = self.config.get('timeout_seconds',120)
        try:
            with httpx.Client(transport=self.transport,timeout=httpx.Timeout(timeout,connect=10),
                              follow_redirects=False,trust_env=False) as client:
                with client.stream('POST',ENDPOINT,headers={'Authorization':'Bearer '+self.api_key.get_secret_value()},json=payload) as response:
                    request_id = response.headers.get('x-request-id')
                    if not request_id or not re.fullmatch(r'[A-Za-z0-9._:-]{1,200}', request_id):
                        request_id = None
                    if response.status_code != 200:
                        # Error bodies never become diagnostics; no inference that
                        # a request was free follows merely from an HTTP status.
                        code = 'authentication' if response.status_code in (401,403) else 'rate_limit' if response.status_code == 429 else 'http_error'
                        self.response = self.failure(code, request_id=request_id)
                        return self.response
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        if len(raw)+len(chunk) > MAX_RESPONSE_BYTES:
                            self.response = self.failure('invalid_response',request_id=request_id)
                            return self.response
                        raw.extend(chunk)
            data = json.loads(raw)
            self.response = self.decode(data,request_id)
        except httpx.TimeoutException:
            self.response = self.failure('timeout')
        except httpx.HTTPError:
            self.response = self.failure('transport')
        except (ValueError,UnicodeError,RecursionError):
            self.response = self.failure('invalid_response')
        return self.response

    @staticmethod
    def failure(code: str, known_zero=False, request_id=None) -> dict:
        """Return a catalogued adapter failure without arbitrary response text."""
        usage = {'input_tokens':0,'output_tokens':0,'cached_input_tokens':0,'reasoning_tokens':0} if known_zero else None
        return {'outcome':'known_failure' if known_zero else 'uncertain','provider_request_id':request_id,'structured_output':None,'usage':usage,'error_code':code}

    @staticmethod
    def decode(data, request_id=None) -> dict:
        """Extract safe accounting and a single structured assistant message."""
        if not isinstance(data,dict):
            return OpenAIAdapter.failure('invalid_response',request_id=request_id)
        usage = data.get('usage')
        accounted = None
        if isinstance(usage,dict):
            cached = usage.get('input_tokens_details') or {}
            reasoning = usage.get('output_tokens_details') or {}
            if isinstance(cached,dict) and isinstance(reasoning,dict):
                values = [usage.get('input_tokens'),usage.get('output_tokens'),cached.get('cached_tokens',0),reasoning.get('reasoning_tokens',0)]
                if all(type(value) is int and value >= 0 for value in values) and values[2] <= values[0] and values[3] <= values[1]:
                    accounted = dict(zip(('input_tokens','output_tokens','cached_input_tokens','reasoning_tokens'),values))
        result = {'outcome':'uncertain','provider_request_id':request_id,'structured_output':None,'usage':accounted,'error_code':'invalid_response'}
        output = data.get('output')
        if not isinstance(output,list):
            return result
        contents = []
        for item in output:
            if not isinstance(item,dict) or item.get('type') not in ('message','reasoning'):
                return result
            if item.get('type') == 'message':
                if item.get('role') != 'assistant' or not isinstance(item.get('content'),list):
                    return result
                contents.extend(item['content'])
        if any(isinstance(item,dict) and item.get('type') == 'refusal' for item in contents):
            return {**result,'outcome':'refused','error_code':'refusal'}
        if data.get('status') == 'incomplete':
            return {**result,'outcome':'incomplete','error_code':'incomplete'}
        if data.get('status') != 'completed' or len(contents) != 1 or not isinstance(contents[0],dict) or contents[0].get('type') != 'output_text':
            return result
        try:
            value = clean_result(json.loads(contents[0]['text']))
        except (KeyError,TypeError,ValueError,RecursionError):
            return result
        return {**result,'outcome':'completed','structured_output':value,'error_code':None}
