"""Sign people in with an OpenID Connect provider (Google by default).

Authorization code flow with PKCE (`authlib`'s S256 challenge), a nonce and a state.
The ID token is verified with the provider's published keys (`joserfc`, authlib's
JOSE library): issuer, audience, expiry and nonce. The result is the stable pair
(issuer, subject); the email is never used to identify a person (T16).
"""
import time

from authlib.oauth2.rfc7636 import create_s256_code_challenge
import httpx
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet


class OidcRefused(Exception):
    """The provider's answer could not be trusted; the message is a short code."""


class Oidc:
    """One configured provider: its metadata and keys are fetched when first needed."""

    def __init__(self, metadata_url: str, client_id: str, client_secret: str, transport=None):
        """Keep the client settings; `transport` lets tests answer for the provider."""
        self.metadata_url, self.client_id, self.client_secret = metadata_url, client_id, client_secret
        self.transport = transport
        self.metadata: dict | None = None
        self.keys: tuple[float, KeySet] | None = None

    async def _get(self, url: str) -> dict:
        """Fetch one JSON document from the provider."""
        async with httpx.AsyncClient(transport=self.transport, timeout=10) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()

    async def _metadata(self) -> dict:
        """Return the provider's discovery document, fetched once per instance."""
        if self.metadata is None:
            self.metadata = await self._get(self.metadata_url)
        return self.metadata

    async def _key_set(self) -> KeySet:
        """Return the provider's signing keys, refreshed at most once an hour."""
        if self.keys is None or time.monotonic() - self.keys[0] > 3600:
            self.keys = (time.monotonic(), KeySet.import_key_set(await self._get((await self._metadata())['jwks_uri'])))
        return self.keys[1]

    async def authorization_url(self, redirect_uri: str, state: str, nonce: str, verifier: str) -> str:
        """Return the provider URL that starts sign-in."""
        endpoint = (await self._metadata())['authorization_endpoint']
        query = httpx.QueryParams({'response_type': 'code', 'client_id': self.client_id, 'redirect_uri': redirect_uri,
            'scope': 'openid', 'state': state, 'nonce': nonce, 'prompt': 'select_account',
            'code_challenge': create_s256_code_challenge(verifier), 'code_challenge_method': 'S256'})
        return f'{endpoint}?{query}'

    async def identity(self, code: str, redirect_uri: str, nonce: str, verifier: str) -> tuple[str, str]:
        """Exchange the code and return the verified (issuer, subject)."""
        metadata = await self._metadata()
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=10) as client:
                response = await client.post(metadata['token_endpoint'], data={'grant_type': 'authorization_code',
                    'code': code, 'redirect_uri': redirect_uri, 'client_id': self.client_id,
                    'client_secret': self.client_secret, 'code_verifier': verifier})
                response.raise_for_status()
                id_token = response.json()['id_token']
            token = jwt.decode(id_token, await self._key_set(), algorithms=['RS256', 'ES256'])
            jwt.JWTClaimsRegistry(iss={'essential': True, 'value': metadata['issuer']},
                aud={'essential': True, 'value': self.client_id}, nonce={'essential': True, 'value': nonce},
                sub={'essential': True}, exp={'essential': True}).validate(token.claims)
        except (httpx.HTTPError, KeyError, ValueError, JoseError):
            raise OidcRefused('oidc_refused') from None
        return token.claims['iss'], token.claims['sub']
