"""What every moderation page shares: the session cookie, form checks and rendering.

The session cookie holds a random token (HttpOnly, SameSite=Strict, Secure unless
configured off for local HTTP); the database stores its hash. Every POST must come
from this origin; POSTs of a signed-in person also carry the per-session form token.
"""
from urllib.parse import parse_qs

from fastapi import HTTPException, Request
from fastapi.templating import Jinja2Templates

from . import auth
from .desk import Desk

COOKIE = 'egi_moderation'
OIDC_COOKIE = 'egi_moderation_oidc'
PATH = '/moderazione'
MAX_FORM = 64 * 1024
HEADERS = {'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',  # 'no-referrer' makes browsers send Origin: null
           'Content-Security-Policy': "default-src 'self'; img-src 'self' https://tile.openstreetmap.org; "
                                      "form-action 'self' https:; frame-ancestors 'none'"}


class Moderation:
    """Own the moderation resources of one application instance."""

    def __init__(self, settings, templates: Jinja2Templates, catalog, oidc=None, desk: Desk | None = None):
        """Keep settings, the editorial desk, the optional OIDC provider and the catalog."""
        self.settings = settings
        self.secret = settings.cookie_secret.get_secret_value()
        self.desk = desk or Desk(settings.database_url.get_secret_value())
        self.templates, self.catalog, self.oidc = templates, catalog, oidc

    def text(self, key: str, **values) -> str:
        """Return Italian-first moderation text from the catalogs."""
        return self.catalog.text(key, 'it', **values)

    def session_hash(self, request: Request) -> str | None:
        """Return the hash of the session token the browser sent, if any."""
        token = request.cookies.get(COOKIE)
        return auth.token_hash(token) if token else None

    def person(self, request: Request) -> dict | None:
        """Return the person of a valid session, or None."""
        return self.desk.person(self.session_hash(request))

    def render(self, request: Request, name: str, person: dict | None = None, status: int = 200, **context):
        """Render a moderation template with its text lookup, person and form token."""
        session = self.session_hash(request)
        response = self.templates.TemplateResponse(request=request, name=f'moderation/{name}', status_code=status,
            context={'t': self.text, 'person': person, 'google': self.oidc is not None,
                     'form_token': auth.form_token(self.secret, session) if person and session else '', **context})
        response.headers.update(HEADERS)
        return response

    def start_session(self, response, token: str):
        """Set the session cookie for a token the database has just accepted."""
        response.set_cookie(COOKIE, token, max_age=14 * 24 * 3600, path=PATH, httponly=True,
                            secure=self.settings.secure_cookie, samesite='strict')

    def end_session(self, response):
        """Remove the session cookie."""
        response.delete_cookie(COOKIE, path=PATH, httponly=True, secure=self.settings.secure_cookie, samesite='strict')

    @staticmethod
    async def form(request: Request) -> dict[str, str]:
        """Parse a urlencoded form body without a multipart dependency; last value wins."""
        body = await request.body()
        if len(body) > MAX_FORM:
            raise HTTPException(413)
        return {key: values[-1] for key, values in parse_qs(body.decode('utf-8', 'replace')).items()}

    @staticmethod
    def same_origin(request: Request) -> bool:
        """Accept a POST only when the browser says it comes from this origin."""
        return request.headers.get('origin') == f'{request.url.scheme}://{request.url.netloc}'

    def check_post(self, request: Request, form: dict, signed_in: bool = True):
        """Refuse a POST from another origin or, when signed in, without the form token."""
        if not self.same_origin(request) or (signed_in and not auth.form_token_matches(
                self.secret, self.session_hash(request) or '', form.get('form_token'))):
            raise HTTPException(403)
