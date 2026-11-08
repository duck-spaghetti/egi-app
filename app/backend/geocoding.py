"""Submit-only Nominatim adapter with bounded memory cache and cross-worker throttling.

Only explicit address searches leave this process. The shared lock stores a request
start timestamp, never query text; original source records are not geocoded.
"""

from collections import OrderedDict
import fcntl
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
CACHE_SECONDS = 3600
MAX_RESPONSE = 512_000
_CACHE = OrderedDict()
_LOCK = threading.Lock()


def fetch_results(query: str) -> list:
    """Fetch at most five candidates within the approved Rome-area search bounds."""
    params = urllib.parse.urlencode({"q": query, "format": "jsonv2", "limit": 5,
        "accept-language": "it", "countrycodes": "it", "viewbox": "11.5,42.7,13.7,41.0", "bounded": 1})
    request = urllib.request.Request(PROVIDER + "?" + params, headers={
        "User-Agent": "EGI-local-preview/0.2 (interactive Rome address search)", "Accept": "application/json"})
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
    fetch = fetch or fetch_results
    key = (PROVIDER, query.casefold())
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            _CACHE.move_to_end(key)
            return cached[1]
        RATE_FILE.parent.mkdir(parents=True, exist_ok=True)
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
        for row in raw[:5]:
            lat, lon = float(row["lat"]), float(row["lon"])
            if math.isfinite(lat) and math.isfinite(lon) and 41 <= lat <= 42.7 and 11.5 <= lon <= 13.7:
                results.append({"lat": lat, "lon": lon, "label": str(row["display_name"])[:400]})
        _CACHE[key] = (time.monotonic(), results)
        _CACHE.move_to_end(key)
        while len(_CACHE) > CACHE_LIMIT:
            _CACHE.popitem(last=False)
        return results
