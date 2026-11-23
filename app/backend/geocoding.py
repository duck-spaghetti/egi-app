"""Submit-only Nominatim adapter with bounded memory cache and cross-worker throttling.

Only explicit address searches leave this process. The shared lock stores a request
start timestamp, never query text; original source records are not geocoded.
"""

from .app_profile import profile

from collections import OrderedDict
import fcntl
import hashlib
import hmac
import secrets
import json
import math
import os
from pathlib import Path
import ssl
import threading
import time
import urllib.parse
import urllib.request

PROVIDER = os.environ.get("EGI_GEOCODER_URL", "https://nominatim.openstreetmap.org/search")
RATE_FILE = Path(os.environ.get("EGI_GEOCODER_RATE_FILE", Path(__file__).resolve().parents[3] / ".local/geocoding/request.lock"))
CACHE_LIMIT = 128
CACHE_SECONDS = 300
_CACHE_KEY = secrets.token_bytes(32)
MAX_RESPONSE = 512_000
_CACHE = OrderedDict()
_LOCK = threading.Lock()


def _country() -> str:
    """Return the resolved territory's country code, the provider filter for searches."""
    from .runtime import CANONICAL, DIRECTORY
    from .app_profile import resolved
    return resolved(DIRECTORY.snapshot()["territory"] if CANONICAL else None)["country_code"].lower()


def fetch_results(query: str, country: str | None = None) -> list:
    """Fetch at most five candidates within the configured search extent and country."""
    policy=profile()
    country=country or _country()
    west,south,east,north=policy.search_extent
    params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 5,
        "accept-language": "it", "countrycodes": country, "viewbox": f"{west},{north},{east},{south}", "bounded": 1})
    request = urllib.request.Request(PROVIDER + "?" + params, headers={
        "User-Agent": "EGI/0.2 (interactive directory address search)", "Accept": "application/json"})
    context = ssl.create_default_context()
    if Path("/etc/ssl/cert.pem").is_file():
        context.load_verify_locations("/etc/ssl/cert.pem")
    with urllib.request.urlopen(request, context=context, timeout=8) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Geocoder response too large")
    return json.loads(raw)


def search_address(query: str, fetch=None) -> list[dict]:
    """Validate, cache and serialize searches; raise on malformed/unavailable provider."""
    query = " ".join(query.split())
    if not 3 <= len(query) <= 200:
        raise ValueError("Address must contain 3–200 characters")
    country = None if fetch else _country()
    fetch = fetch or (lambda text: fetch_results(text, country))
    scope = profile().model_dump_json() + (country or "")
    key = hmac.new(_CACHE_KEY,(PROVIDER+scope+query.casefold()).encode(),hashlib.sha256).digest()
    # _LOCK guards only the in-memory cache, never the throttle or upstream call,
    # so active expiry on the event loop cannot wait behind a slow provider.
    with _LOCK:
        _expire_cache(time.monotonic())
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            _CACHE.move_to_end(key)
            return cached[1]
    RATE_FILE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with RATE_FILE.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        lock.seek(0)
        previous = float(lock.read() or 0)
        time.sleep(max(0, min(1, 1 - (time.time() - previous))))
        lock.seek(0)
        lock.truncate()
        lock.write(str(time.time()))
        lock.flush()
        raw = fetch(query)
    if not isinstance(raw, list):
        raise ValueError("Invalid geocoder response")
    results = []
    west,south,east,north=profile().search_extent
    for row in raw[:5]:
        lat, lon = float(row["lat"]), float(row["lon"])
        if math.isfinite(lat) and math.isfinite(lon) and south <= lat <= north and west <= lon <= east:
            results.append({"lat": lat, "lon": lon, "label": str(row["display_name"])[:400]})
    with _LOCK:
        _CACHE[key] = (time.monotonic(), results)
        _CACHE.move_to_end(key)
        while len(_CACHE) > CACHE_LIMIT:
            _CACHE.popitem(last=False)
    return results


def _expire_cache(now: float) -> None:
    """Drop expired response memory while its caller owns the cache lock."""
    for key in list(_CACHE):
        if now-_CACHE[key][0]>=CACHE_SECONDS:
            del _CACHE[key]


def expire_cache() -> None:
    """Actively expire response memory; skip a busy tick rather than block the event loop."""
    if _LOCK.acquire(blocking=False):
        try:
            _expire_cache(time.monotonic())
        finally:
            _LOCK.release()
