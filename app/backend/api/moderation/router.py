"""Moderation pages: sign-in, invitations and accounts (EGI-57).

Not linked from public pages. Every signed-in page asks the database to verify the
session first; admin pages are refused by the database for anyone else.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from . import auth
from .desk import Refused
from .oidc import OidcRefused
from .service import Moderation, OIDC_COOKIE, PATH

router = APIRouter(prefix=PATH)
# Verifying an unknown login still costs one argon2 check, so timing does not tell.
DUMMY_HASH = auth.PASSWORDS.hash(secrets.token_urlsafe(16))


def moderation(request: Request) -> Moderation:
    """Return this application's moderation resources."""
    return request.app.state.resources.moderation


def home_redirect() -> RedirectResponse:
    """Send the browser back to the moderation home after a POST."""
    return RedirectResponse(PATH, status_code=303)


def signed_in(request: Request, module: Moderation) -> dict:
    """Return the verified person or refuse with 403."""
    person = module.person(request)
    if person is None:
        raise HTTPException(403)
    return person


@router.get('', response_class=HTMLResponse)
def home(request: Request, module: Moderation = Depends(moderation)):
    """Show the signed-in home, or the sign-in page."""
    person = module.person(request)
    if person is None:
        return module.render(request, 'login.html')
    return module.render(request, 'home.html', person)


@router.post('/accedi')
async def sign_in(request: Request, module: Moderation = Depends(moderation)):
    """Sign in with login, password and, when the account has one, a TOTP code."""
    form = await module.form(request)
    module.check_post(request, form, signed_in=False)
    row = module.desk.one('SELECT * FROM access.password_material(%s)', (form.get('login', '').strip().lower(),))
    valid = auth.password_matches(row['password_hash'] if row else DUMMY_HASH, form.get('password', '')) and row is not None
    second = bool(row and row['totp_secret'])
    if valid and second:
        valid = auth.code_matches(row['totp_secret'], form.get('code', ''))
    if not valid:
        return module.render(request, 'login.html', status=401, error='wrong_credentials')
    token, digest = auth.new_token()
    module.desk.one("SELECT access.open_session(%s,%s,'password',%s)", (row['account_id'], digest, second))
    response = home_redirect()
    module.start_session(response, token)
    return response


@router.post('/esci')
async def sign_out(request: Request, module: Moderation = Depends(moderation)):
    """End this browser's session."""
    form = await module.form(request)
    module.check_post(request, form)
    module.desk.one('SELECT access.close_session(%s)', (module.session_hash(request),))
    response = home_redirect()
    module.end_session(response)
    return response


@router.get('/google')
async def google_start(request: Request, invito: str | None = None, module: Moderation = Depends(moderation)):
    """Start sign-in with the provider; `invito` binds the identity to an invitation."""
    if module.oidc is None:
        raise HTTPException(404)
    state, nonce, verifier = (secrets.token_urlsafe(24) for _ in range(3))
    url = await module.oidc.authorization_url(str(request.url_for('google_return')), state, nonce, verifier)
    response = RedirectResponse(url, status_code=303)
    response.set_cookie(OIDC_COOKIE, auth.sign(module.secret, {'state': state, 'nonce': nonce, 'verifier': verifier,
        'invitation': invito}), max_age=600, path=PATH, httponly=True, secure=module.settings.secure_cookie, samesite='lax')
    return response


@router.get('/google/ritorno', name='google_return')
async def google_return(request: Request, code: str = '', state: str = '', module: Moderation = Depends(moderation)):
    """Finish provider sign-in, accept a pending invitation, and open a session."""
    if module.oidc is None:
        raise HTTPException(404)
    started = auth.unsign(module.secret, request.cookies.get(OIDC_COOKIE), 600)
    if not started or not code or not secrets.compare_digest(started['state'], state):
        return module.render(request, 'login.html', status=401, error='oidc_refused')
    try:
        issuer, subject = await module.oidc.identity(code, str(request.url_for('google_return')),
                                                     started['nonce'], started['verifier'])
        if started.get('invitation'):
            account = module.desk.one('SELECT access.accept_invitation(%s,%s,NULL,%s,%s,NULL) AS account',
                (auth.token_hash(started['invitation']), 'oidc', issuer, subject))['account']
        else:
            row = module.desk.one('SELECT account_id FROM access.oidc_account(%s,%s)', (issuer, subject))
            if row is None:
                return module.render(request, 'login.html', status=401, error='unknown_identity')
            account = row['account_id']
        token, digest = auth.new_token()
        module.desk.one("SELECT access.open_session(%s,%s,'oidc',false)", (account, digest))
    except (OidcRefused, Refused) as refusal:
        return module.render(request, 'login.html', status=401, error=getattr(refusal, 'code', 'oidc_refused'))
    # A page, not a redirect: after a cross-site return the Strict cookie is only sent
    # on a navigation that starts here.
    response = module.render(request, 'continue.html')
    module.start_session(response, token)
    response.delete_cookie(OIDC_COOKIE, path=PATH)
    return response


@router.get('/invito/{token}', response_class=HTMLResponse)
def invitation(request: Request, token: str, module: Moderation = Depends(moderation)):
    """Show an open invitation: Google, or a password with a TOTP enrolment."""
    row = module.desk.one('SELECT * FROM access.read_invitation(%s)', (auth.token_hash(token),))
    if row is None:
        return module.render(request, 'message.html', status=404, message='invitation_invalid')
    secret = auth.new_totp_secret()
    return module.render(request, 'invitation.html', invitation=row, token=token,
                         totp_secret=secret, totp_uri=auth.totp_uri(secret, row['login_name']))


@router.post('/invito/{token}')
async def accept_invitation(request: Request, token: str, module: Moderation = Depends(moderation)):
    """Accept an invitation with a password; the admin must also confirm a TOTP code."""
    form = await module.form(request)
    module.check_post(request, form, signed_in=False)
    row = module.desk.one('SELECT * FROM access.read_invitation(%s)', (auth.token_hash(token),))
    if row is None:
        return module.render(request, 'message.html', status=404, message='invitation_invalid')
    secret, code = form.get('totp_secret', ''), form.get('code', '').strip()
    error = None
    if form.get('password', '') != form.get('password_again', ''):
        error = 'passwords_differ'
    elif len(form.get('password', '')) < auth.MIN_PASSWORD:
        error = 'password_too_short'
    elif (row['role'] == 'admin' or code) and not auth.code_matches(secret, code):
        error = 'wrong_code'
    if error:
        return module.render(request, 'invitation.html', status=400, invitation=row, token=token, error=error,
                             totp_secret=secret, totp_uri=auth.totp_uri(secret, row['login_name']))
    enrolled = secret if code else None
    try:
        account = module.desk.one('SELECT access.accept_invitation(%s,%s,%s,NULL,NULL,%s) AS account',
            (auth.token_hash(token), 'password', auth.hash_password(form['password']), enrolled))['account']
        session, digest = auth.new_token()
        module.desk.one("SELECT access.open_session(%s,%s,'password',%s)", (account, digest, enrolled is not None))
    except Refused as refusal:
        return module.render(request, 'message.html', status=400, message=refusal.code)
    response = home_redirect()
    module.start_session(response, session)
    return response


def accounts_page(request: Request, module: Moderation, person: dict, **context):
    """Render the account list with each account's open sessions, as the admin."""
    with module.desk.acting(module.session_hash(request)) as (connection, _):
        accounts = connection.execute('SELECT * FROM access.list_accounts()').fetchall()
        for account in accounts:
            account['sessions'] = connection.execute('SELECT * FROM access.list_sessions(%s)',
                                                     (account['account_id'],)).fetchall()
    return module.render(request, 'accounts.html', person, accounts=accounts, **context)


def admin(request: Request, module: Moderation) -> dict:
    """Return the verified person when they are the admin, else refuse with 403."""
    person = signed_in(request, module)
    if person['role'] != 'admin':
        raise HTTPException(403)
    return person


@router.get('/account', response_class=HTMLResponse)
def accounts(request: Request, module: Moderation = Depends(moderation)):
    """List accounts and sessions for the admin; others go back to the home page."""
    person = module.person(request)
    if person is None or person['role'] != 'admin':
        return home_redirect()
    return accounts_page(request, module, person)


@router.post('/account')
async def create_account(request: Request, module: Moderation = Depends(moderation)):
    """Create an account and show its one-time invitation link once."""
    form = await module.form(request)
    module.check_post(request, form)
    person = admin(request, module)
    token, digest = auth.new_token()
    try:
        module.desk.as_person(module.session_hash(request), 'SELECT access.create_account(%s,%s,%s,%s)',
            (form.get('login', '').strip().lower(), form.get('display_name', '').strip(), form.get('role'), digest))
    except Refused as refusal:
        return accounts_page(request, module, person, error=refusal.code)
    return accounts_page(request, module, person, link=f'{request.base_url}{PATH[1:]}/invito/{token}')


@router.post('/account/{account}/invito')
async def reissue(request: Request, account: str, module: Moderation = Depends(moderation)):
    """Issue a new invitation (recovery); its acceptance replaces every sign-in method."""
    form = await module.form(request)
    module.check_post(request, form)
    person = admin(request, module)
    token, digest = auth.new_token()
    try:
        module.desk.as_person(module.session_hash(request), 'SELECT access.reissue_invitation(%s,%s)', (account, digest))
    except Refused as refusal:
        return accounts_page(request, module, person, error=refusal.code)
    return accounts_page(request, module, person, link=f'{request.base_url}{PATH[1:]}/invito/{token}')


@router.post('/account/{account}/disattiva')
async def deactivate(request: Request, account: str, module: Moderation = Depends(moderation)):
    """Deactivate an account: its sessions and invitations end at once."""
    form = await module.form(request)
    module.check_post(request, form)
    person = admin(request, module)
    try:
        module.desk.as_person(module.session_hash(request), 'SELECT access.deactivate_account(%s)', (account,))
    except Refused as refusal:
        return accounts_page(request, module, person, error=refusal.code)
    return accounts_page(request, module, person)


@router.post('/sessione/{session}/revoca')
async def revoke(request: Request, session: str, module: Moderation = Depends(moderation)):
    """Revoke one session of any account."""
    form = await module.form(request)
    module.check_post(request, form)
    person = admin(request, module)
    module.desk.as_person(module.session_hash(request), 'SELECT access.revoke_session(%s)', (session,))
    return accounts_page(request, module, person)


from .queue import router as queue_router  # noqa: E402  (after this module's routes, same prefix)
from .workspace import router as workspace_router  # noqa: E402
router.include_router(queue_router)
router.include_router(workspace_router)
