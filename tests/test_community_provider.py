"""Controlled HTTP responses validate one-call provider behavior and independent usage.

All exchanges use MockTransport with a fake key, including failure paths. No test
loads runtime credentials, selects a real model or makes a provider request.
"""
import json
import unittest
from copy import deepcopy

import httpx
from pydantic import SecretStr
from review.insertion import interpret

from app.backend.api.preparations.interpretation.provider import ConfigurationError, ENDPOINT, OpenAIAdapter
from app.backend.api.preparations.interpretation.schema import output_schema
from tests.community_fixtures import CONFIG, request, result


class ProviderTests(unittest.TestCase):
    """Exercise actual transport/decoding through closed synthetic HTTP responses."""

    def adapter(self, handler, config=None, max_input=300000):
        """Build an adapter whose only transport is a deterministic local callback."""
        return OpenAIAdapter(config or CONFIG,SecretStr('fake-key-for-mock-only'),max_input,2000,transport=httpx.MockTransport(handler))

    def test_one_call_schema_usage_and_exact_unicode(self):
        """Real request construction is stateless/tool-free and preserves code-point evidence."""
        req = request('Sportello à Roma\r\n')
        calls = []

        def response(exchange):
            """Return one controlled assistant result and token-accounting envelope."""
            self.assertEqual(str(exchange.url),ENDPOINT)
            payload = json.loads(exchange.content)
            calls.append(payload)
            self.assertFalse(payload['store'])
            self.assertNotIn('tools',payload)
            self.assertNotIn('previous_response_id',payload)
            self.assertEqual(payload['max_output_tokens'],2000)
            data = json.loads(payload['input'][0]['content'][0]['text'])
            self.assertEqual(data['text'],req['text'])
            value = result(data)
            value['candidates'][0]['service']['description'] = None
            return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant',
                'content':[{'type':'output_text','text':json.dumps(value)}]}],
                'usage':{'input_tokens':100,'output_tokens':20,'input_tokens_details':{'cached_tokens':10},'output_tokens_details':{'reasoning_tokens':5}}},headers={'x-request-id':'fixture-request'})
        adapter = self.adapter(response)
        value = interpret(req,adapter)
        self.assertEqual(value['state'],'complete')
        self.assertEqual(value['candidates'][0]['service'],{'name':req['text']})
        self.assertEqual(adapter.response['usage']['reasoning_tokens'],5)
        self.assertEqual(len(calls),1)
        with self.assertRaises(ConfigurationError):
            adapter(req)
        self.assertEqual(len(calls),1)
        schema = json.dumps(output_schema(req))
        self.assertNotIn('is_public',schema)
        self.assertNotIn('component_id',schema)
        self.assertNotIn('location_id',schema)

    def test_invalid_quote_still_retains_actual_usage(self):
        """A semantic rejection cannot discard known accounting or trigger a repair."""
        req = request()
        output = result(req)
        output['candidates'][0]['evidence'][0]['quote'] = 'Invented source quote'

        def response(_):
            """Provide malformed semantic content with otherwise valid provider usage."""
            return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(output)}]}], 'usage':{'input_tokens':40,'output_tokens':30}})
        adapter = self.adapter(response)
        self.assertEqual(interpret(req,adapter)['state'],'incomplete')
        self.assertEqual(adapter.response['usage']['input_tokens'],40)

    def test_nullable_cleanup_does_not_hide_unsupported_keys(self):
        """Unknown null fields still fail the independent closed-output validator."""
        req = request()
        output = result(req)
        output['candidates'][0]['service']['unsupported_null'] = None
        adapter = self.adapter(lambda _: httpx.Response(200,json={'status':'completed',
            'output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(output)}]}],
            'usage':{'input_tokens':10,'output_tokens':5}}))
        self.assertEqual(interpret(req,adapter)['state'],'incomplete')
        self.assertEqual(adapter.response['usage']['input_tokens'],10)

    def test_refused_incomplete_and_tool_outputs(self):
        """Refusal, truncation and unexpected tool items never materialize candidate cards."""
        for status,output,expected in (
            ('completed',[{'type':'message','role':'assistant','content':[{'type':'refusal','refusal':'DO NOT ECHO'}]}],'refused'),
            ('incomplete',[],'incomplete'),
            ('completed',[{'type':'function_call','name':'fetch_url','arguments':'PRIVATE'}],'incomplete')):
            with self.subTest(status=status,output=output):
                adapter = self.adapter(lambda _: httpx.Response(200,json={'status':status,'output':output,'usage':{'input_tokens':10,'output_tokens':5}}))
                value = interpret(request(),adapter)
                self.assertEqual(value['state'],expected)
                self.assertEqual(value['candidates'],[])
                self.assertNotIn('PRIVATE',json.dumps(value))
                self.assertNotIn('DO NOT ECHO',json.dumps(value))
                self.assertIsNotNone(adapter.response['usage'])

    def test_timeouts_http_errors_and_oversized_payloads_do_not_retry(self):
        """Ambiguous outcomes retain unknown usage; local size refusal is known-zero."""
        for kind in ('timeout','http','large'):
            calls = []

            def response(exchange):
                """Return or throw the selected controlled external failure exactly once."""
                calls.append(exchange)
                if kind == 'timeout':
                    raise httpx.ReadTimeout('PRIVATE RESPONSE',request=exchange)
                if kind == 'http':
                    return httpx.Response(429,text='PRIVATE RESPONSE')
                return httpx.Response(200,content=b'x'*(2*1024*1024+1))
            adapter = self.adapter(response)
            value = interpret(request(),adapter)
            self.assertEqual(len(calls),1)
            self.assertIsNone(adapter.response['usage'])
            self.assertEqual(value['state'],'incomplete')
            self.assertNotIn('PRIVATE',json.dumps(value))
        calls = []
        adapter = self.adapter(lambda r: calls.append(r),max_input=1)
        self.assertEqual(interpret(request(),adapter)['state'],'incomplete')
        self.assertEqual(calls,[])
        self.assertEqual(adapter.response['usage']['input_tokens'],0)

    def test_fixture_configuration_cannot_use_real_network_transport(self):
        """A demo/test configuration remains unable to send to the actual provider."""
        with self.assertRaises(ConfigurationError):
            OpenAIAdapter(CONFIG,SecretStr('fake-key'),300000,2000)

    def test_configuration_requires_explicit_data_and_dispatch_settings(self):
        """A key alone is insufficient to authorize live provider dispatch."""
        for field,value in (('store',True),('live_authorized',False),('provider','other'),('model','bad model'),
                            ('interpretation_version',True),('interpretation_version',3)):
            config = deepcopy(CONFIG)
            config[field] = value
            with self.subTest(field=field),self.assertRaises(ConfigurationError):
                self.adapter(lambda _: None,config)

    def test_v2_output_schema_uses_the_pinned_literal_fact_dictionary(self):
        """Actual provider requests require v2 facts without exposing canonical roles."""
        req = request('Sportello')
        req.update(schema_version=2, field_dictionary_version='egi-preparation-fields/2', requested_output_shape='interpretation.result.v2')
        calls = []

        def response(exchange):
            """Capture the real constructed schema and return a controlled v2 result."""
            body = json.loads(exchange.content)
            calls.append(body)
            schema = body['text']['format']['schema']
            self.assertEqual(schema['properties']['schema_version']['enum'], [2])
            candidate = schema['properties']['candidates']['items']['properties']
            self.assertEqual(set(candidate['source_facts']['items']['properties']), {'fact_key','subject','kind','source_value'})
            self.assertNotIn('organizations', candidate['service']['properties'])
            self.assertNotIn('classifications', candidate['service']['properties'])
            return httpx.Response(200,json={'status':'completed','output':[{'type':'message','role':'assistant',
                'content':[{'type':'output_text','text':json.dumps(result(req))}]}], 'usage':{'input_tokens':100,'output_tokens':20}})
        actual = interpret(req, self.adapter(response, {**CONFIG, 'interpretation_version':2}))
        self.assertEqual(actual['schema_version'],2)
        self.assertEqual(actual['state'],'complete')
        self.assertEqual(len(calls),1)
