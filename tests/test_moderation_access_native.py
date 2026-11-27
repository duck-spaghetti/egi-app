"""Moderation sign-in, invitations and accounts through HTTP on a real database (EGI-57).

Needs EGI_DATABASE_REPO (see tests/native.py). Google is a fake provider here;
tests/test_moderation_oidc.py checks the real token verification.
"""
import contextlib
from unittest import mock
import getpass
import io
import re
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient
import pyotp

from app.backend.api.moderation import bootstrap
from app.backend.api.moderation.oidc import OidcRefused
from app.backend.api.preview.subjects import StaticSubjectSource
from app.backend.config import Configuration, EditorialSettings, profile
from app.backend.main import create_app
from tests.native import REPOSITORY, Cluster

ORIGIN = {'origin': 'http://testserver'}
ISSUER = 'https://accounts.google.com'


class FakeOidc:
    """Answer for Google: the code `sub-…` signs in as that subject."""

    async def authorization_url(self, redirect_uri, state, nonce, verifier):
        """Return a provider URL carrying the state, as Google would."""
        return f'https://idp.invalid/auth?state={state}'

    async def identity(self, code, redirect_uri, nonce, verifier):
        """Return (issuer, subject) for a well-formed code, else refuse."""
        if not code.startswith('sub-'):
            raise OidcRefused('oidc_refused')
        return ISSUER, code


def field(html: str, name: str) -> str:
    """Return the value of a hidden input in a page."""
    return re.search(rf'name="{name}" value="([^"]*)"', html).group(1)


@unittest.skipUnless(REPOSITORY, 'needs explicit EGI_DATABASE_REPO native schema fixture')
class ModerationAccessTests(unittest.TestCase):
    """Sign-in methods, refusals, invitations, revocation and deactivation."""

    @classmethod
    def setUpClass(cls):
        """Deploy a cluster, create the editorial login and bootstrap the first admin."""
        cls.cluster = Cluster(65441, 'egi_moderation_access')
        cls.addClassCleanup(cls.cluster.close)
        cls.cluster.sql('CREATE ROLE egi_test_desk LOGIN IN ROLE egi_editorial')
        output = io.StringIO()
        with contextlib.redirect_stdout(output), mock.patch.dict(
                'os.environ', {'EGI_OWNER_DATABASE_URL': cls.cluster.dsn(getpass.getuser())}):
            assert bootstrap.main(['admin1', 'Admin One', '--origin', 'http://testserver']) == 0
        cls.admin_link = urlsplit(output.getvalue().strip()).path
        errors = tempfile.TemporaryDirectory()
        cls.addClassCleanup(errors.cleanup)
        settings = EditorialSettings(database_url=cls.cluster.dsn('egi_test_desk'), cookie_secret='s' * 40, secure_cookie=False)
        cls.app = create_app(Configuration(profile(), error_dir=Path(errors.name), editorial=settings),
                             {'source': StaticSubjectSource([]), 'oidc': FakeOidc()})

    def client(self) -> TestClient:
        """Return a browser with its own cookies for this app."""
        client = TestClient(self.app)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def google(self, client: TestClient, code: str, invitation: str | None = None):
        """Run the provider round trip and return the callback response."""
        start = client.get('/moderazione/google', params={'invito': invitation} if invitation else None, follow_redirects=False)
        self.assertEqual(start.status_code, 303)
        state = parse_qs(urlsplit(start.headers['location']).query)['state'][0]
        return client.get('/moderazione/google/ritorno', params={'code': code, 'state': state})

    def form_token(self, client: TestClient) -> str:
        """Return the form token of the signed-in home page."""
        return field(client.get('/moderazione').text, 'form_token')

    def test_sign_in_journeys(self):
        """Admin by password and TOTP, moderator by Google, then revocation and deactivation."""
        admin = self.client()
        self.assertIn('Accedi', admin.get('/moderazione').text)
        self.assertEqual(admin.get('/moderazione/account', follow_redirects=False).status_code, 303)
        self.assertEqual(admin.post('/moderazione/account', data={'login': 'x'}, headers=ORIGIN).status_code, 403)
        self.assertEqual(admin.post('/moderazione/accedi', data={'login': 'admin1'}).status_code, 403, 'POST without Origin')

        # The admin's invitation needs a TOTP code; it works once.
        page = admin.get(self.admin_link).text
        secret = field(page, 'totp_secret')
        refused = admin.post(self.admin_link, data={'password': 'correct horse battery', 'password_again': 'correct horse battery',
                                                    'totp_secret': secret}, headers=ORIGIN)
        self.assertEqual(refused.status_code, 400)
        self.assertIn('codice non è corretto', refused.text)
        accepted = admin.post(self.admin_link, data={'password': 'correct horse battery', 'password_again': 'correct horse battery',
            'totp_secret': secret, 'code': pyotp.TOTP(secret).now()}, headers=ORIGIN, follow_redirects=False)
        self.assertEqual(accepted.status_code, 303)
        self.assertIn('Ciao, Admin One', admin.get('/moderazione').text)
        self.assertEqual(admin.get(self.admin_link).status_code, 404, 'an invitation works once')

        # Sign out, then password sign-in: the admin always needs the code.
        token = self.form_token(admin)
        admin.post('/moderazione/esci', data={'form_token': token}, headers=ORIGIN)
        self.assertIn('Accedi', admin.get('/moderazione').text)
        for data in ({'login': 'admin1', 'password': 'wrong password!!'}, {'login': 'admin1', 'password': 'correct horse battery'},
                     {'login': 'admin1', 'password': 'correct horse battery', 'code': '000000'}, {'login': 'nobody', 'password': 'x' * 12}):
            self.assertEqual(admin.post('/moderazione/accedi', data=data, headers=ORIGIN).status_code, 401, data)
        signed = admin.post('/moderazione/accedi', data={'login': 'admin1', 'password': 'correct horse battery',
                                                          'code': pyotp.TOTP(secret).now()}, headers=ORIGIN, follow_redirects=False)
        self.assertEqual(signed.status_code, 303)

        # The admin invites a moderator; a signed-in POST needs Origin and form token.
        token = self.form_token(admin)
        self.assertEqual(admin.post('/moderazione/account', data={'login': 'mod1', 'display_name': 'Mod One', 'role': 'moderator'},
                                    headers=ORIGIN).status_code, 403, 'no form token')
        self.assertEqual(admin.post('/moderazione/account', data={'login': 'mod1', 'display_name': 'Mod One', 'role': 'moderator',
            'form_token': token}, headers={'origin': 'https://evil.invalid'}).status_code, 403, 'foreign origin')
        created = admin.post('/moderazione/account', data={'login': 'mod1', 'display_name': 'Mod One', 'role': 'moderator',
                                                            'form_token': token}, headers=ORIGIN)
        link = urlsplit(re.search(r'value="(http://testserver/moderazione/invito/[^"]+)"', created.text).group(1)).path
        invitation = link.rsplit('/', 1)[1]

        # The moderator accepts with Google; the identity is bound by subject.
        moderator = self.client()
        self.assertEqual(moderator.get('/moderazione/google/ritorno', params={'code': 'sub-1', 'state': 'forged'}).status_code, 401)
        self.assertEqual(self.google(moderator, 'sub-1', invitation).status_code, 200)
        self.assertIn('Ciao, Mod One', moderator.get('/moderazione').text)
        self.assertEqual(moderator.get('/moderazione/account', follow_redirects=False).status_code, 303, 'not the admin')
        self.assertEqual(moderator.post('/moderazione/account', data={'login': 'mod9', 'display_name': 'X', 'role': 'admin',
                                        'form_token': self.form_token(moderator)}, headers=ORIGIN).status_code, 403)
        again = self.client()
        self.assertEqual(self.google(again, 'sub-1').status_code, 200)
        self.assertIn('Ciao, Mod One', again.get('/moderazione').text)
        stranger = self.client()
        self.assertEqual(self.google(stranger, 'sub-2').status_code, 401)

        # Revoking one session signs out only that browser; deactivation ends the rest.
        accounts = admin.get('/moderazione/account').text
        self.assertEqual(accounts.count('/revoca"'), 3, 'admin and two moderator sessions')
        sessions = re.findall(r'/moderazione/sessione/([0-9a-f-]+)/revoca', accounts)
        token = self.form_token(admin)
        for session in sessions[1:2]:
            admin.post(f'/moderazione/sessione/{session}/revoca', data={'form_token': token}, headers=ORIGIN)
        signed_in = [client for client in (moderator, again) if 'Ciao, Mod One' in client.get('/moderazione').text]
        self.assertEqual(len(signed_in), 1)
        ids = re.findall(r'/moderazione/account/([0-9a-f-]+)/disattiva', accounts)  # ordered by login: admin1, mod1
        mod_id = ids[1]
        refused = admin.post(f'/moderazione/account/{ids[0]}/disattiva', data={'form_token': token}, headers=ORIGIN)
        self.assertIn("ultimo admin", refused.text)
        admin.post(f'/moderazione/account/{mod_id}/disattiva', data={'form_token': token}, headers=ORIGIN)
        self.assertIn('Accedi', signed_in[0].get('/moderazione').text)
        self.assertEqual(self.google(self.client(), 'sub-1').status_code, 401, 'a deactivated account cannot sign in')

        # An expired invitation is refused.
        created = admin.post('/moderazione/account', data={'login': 'mod2', 'display_name': 'Mod Two', 'role': 'moderator',
                                                            'form_token': token}, headers=ORIGIN)
        link = urlsplit(re.search(r'value="(http://testserver/moderazione/invito/[^"]+)"', created.text).group(1)).path
        self.cluster.sql("UPDATE access.invitations SET created_at=now()-interval '3 days',expires_at=now()-interval '1 day' "
                         "WHERE used_at IS NULL AND revoked_at IS NULL")
        self.assertEqual(self.client().get(link).status_code, 404)
