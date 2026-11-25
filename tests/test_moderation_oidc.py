"""The OpenID Connect client verifies the provider's ID token before trusting it (EGI-57)."""
import asyncio
import time
import unittest
from urllib.parse import parse_qs, urlsplit

import httpx
from joserfc import jwt
from joserfc.jwk import KeySet, RSAKey

from app.backend.api.moderation.oidc import Oidc, OidcRefused

ISSUER = 'https://idp.invalid'
CLIENT = 'egi-client'


class Provider:
    """A provider over httpx.MockTransport that signs ID tokens with a test key."""

    def __init__(self):
        """Create the signing key and the claims the next token will carry."""
        self.key = RSAKey.generate_key(2048, parameters={'kid': 'k1'})
        self.claims = {}
        self.posted = {}

    def handle(self, request: httpx.Request) -> httpx.Response:
        """Serve discovery, keys and the token endpoint."""
        if request.url.path == '/.well-known/openid-configuration':
            return httpx.Response(200, json={'issuer': ISSUER, 'authorization_endpoint': f'{ISSUER}/auth',
                                             'token_endpoint': f'{ISSUER}/token', 'jwks_uri': f'{ISSUER}/keys'})
        if request.url.path == '/keys':
            return httpx.Response(200, json=KeySet([self.key]).as_dict(private=False))
        self.posted = parse_qs(request.content.decode())
        signer = self.claims.pop('_signer', self.key)
        return httpx.Response(200, json={'id_token': jwt.encode({'alg': 'RS256', 'kid': 'k1'}, self.claims, signer)})


class OidcTests(unittest.TestCase):
    """Accept a valid token; refuse wrong nonce, audience, issuer, expiry or key."""

    def setUp(self):
        """Point the client at the mock provider."""
        self.provider = Provider()
        self.oidc = Oidc(f'{ISSUER}/.well-known/openid-configuration', CLIENT, 'secret',
                         transport=httpx.MockTransport(self.provider.handle))

    def claims(self, **changes) -> dict:
        """Return valid claims for nonce `n1`, changed as asked."""
        now = int(time.time())
        return {'iss': ISSUER, 'aud': CLIENT, 'sub': 'subject-1', 'nonce': 'n1', 'iat': now, 'exp': now + 300,
                'email': 'someone@example.invalid', **changes}

    def identity(self):
        """Run the code exchange for nonce `n1`."""
        return asyncio.run(self.oidc.identity('code', 'http://testserver/back', 'n1', 'verifier'))

    def test_valid_token_yields_issuer_and_subject(self):
        """The pair, never the email, identifies the person; PKCE is sent."""
        self.provider.claims = self.claims()
        self.assertEqual(self.identity(), (ISSUER, 'subject-1'))
        self.assertEqual(self.provider.posted['code_verifier'], ['verifier'])

    def test_untrusted_tokens_are_refused(self):
        """Every broken claim or a foreign key refuses the sign-in."""
        for changes in ({'nonce': 'other'}, {'aud': 'someone-else'}, {'iss': 'https://evil.invalid'},
                        {'exp': int(time.time()) - 600}, {'_signer': RSAKey.generate_key(2048, parameters={'kid': 'k1'})}):
            with self.subTest(changes=list(changes)):
                self.provider.claims = self.claims(**changes)
                with self.assertRaises(OidcRefused):
                    self.identity()

    def test_authorization_url_carries_state_nonce_and_challenge(self):
        """The start URL asks only for `openid`, with S256 PKCE."""
        url = asyncio.run(self.oidc.authorization_url('http://testserver/back', 's1', 'n1', 'verifier'))
        query = parse_qs(urlsplit(url).query)
        self.assertEqual((query['state'], query['nonce'], query['scope'], query['code_challenge_method']),
                         (['s1'], ['n1'], ['openid'], ['S256']))
        self.assertNotEqual(query['code_challenge'], ['verifier'])
