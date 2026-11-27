"""Tokens, passwords, one-time codes and signed values for moderation.

The database only ever sees SHA-256 hashes of tokens; the browser keeps the token.
Passwords are argon2 hashes made here; TOTP codes are checked here with the secret
the database returns. Form tokens and the short-lived OpenID Connect cookie are
HMAC-signed with the configured cookie secret.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
import pyotp

PASSWORDS = PasswordHasher()
MIN_PASSWORD = 12


def new_token() -> tuple[str, str]:
    """Return a fresh random token and the hash the database stores."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    """Return the lowercase SHA-256 hex digest the database compares."""
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    """Hash a new password; refuse one shorter than MIN_PASSWORD characters."""
    if len(password) < MIN_PASSWORD:
        raise ValueError('password_too_short')
    return PASSWORDS.hash(password)


def password_matches(stored: str | None, password: str) -> bool:
    """Check a password against a stored argon2 hash, never raising on bad input."""
    if not stored or not password:
        return False
    try:
        return PASSWORDS.verify(stored, password)
    except (VerificationError, InvalidHashError):
        return False


def new_totp_secret() -> str:
    """Return a new base32 secret for an authenticator app."""
    return pyotp.random_base32()


def totp_uri(secret: str, login: str) -> str:
    """Return the otpauth URI an authenticator app can import."""
    return pyotp.TOTP(secret).provisioning_uri(name=login, issuer_name='EGI')


def code_matches(secret: str | None, code: str) -> bool:
    """Check a six-digit code, accepting one step of clock drift."""
    code = (code or '').replace(' ', '')
    return bool(secret) and code.isdigit() and len(code) == 6 and pyotp.TOTP(secret).verify(code, valid_window=1)


def form_token(secret: str, session_hash: str) -> str:
    """Return the per-session token every moderation form posts back."""
    return hmac.new(secret.encode(), b'form:' + session_hash.encode(), hashlib.sha256).hexdigest()


def form_token_matches(secret: str, session_hash: str, posted: str | None) -> bool:
    """Compare a posted form token in constant time."""
    return bool(posted) and hmac.compare_digest(form_token(secret, session_hash), posted)


def sign(secret: str, data: dict) -> str:
    """Return `data` with its issue time, encoded and signed."""
    body = base64.urlsafe_b64encode(json.dumps({**data, 'at': int(time.time())}).encode()).decode()
    mac = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f'{body}.{mac}'


def unsign(secret: str, value: str | None, max_age: int) -> dict | None:
    """Return the signed data when the signature holds and it is not older than max_age."""
    try:
        body, mac = (value or '').rsplit('.', 1)
        if not hmac.compare_digest(hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest(), mac):
            return None
        data = json.loads(base64.urlsafe_b64decode(body.encode()))
        return data if time.time() - data['at'] <= max_age else None
    except (ValueError, KeyError, TypeError):
        return None
