"""Own submit-only external lookup, bounded private cache and throttling."""
from pathlib import Path
from collections import OrderedDict
import fcntl
import hashlib
import hmac
import secrets
import json
import math
import os
import ssl
import threading
import time
import urllib.parse
import urllib.request
CACHE_LIMIT=128
CACHE_SECONDS=300
MAX_RESPONSE=512_000

class Geocoder:
    """Provide one configured address lookup Interface with private operational memory."""
    def __init__(self, policy, country, provider, rate_file):
        """Accept explicit policy/provider resources without reading global app state."""
        self.policy, self.country, self.provider, self.rate_file = policy, country, provider, rate_file
        self.cache, self.key, self.lock = OrderedDict(), secrets.token_bytes(32), threading.Lock()

    def _country(self):
        """Resolve the country from this app's selected public territory."""
        return self.country().lower()

    def fetch_results(self, query: str, country: str | None=None) -> list:
        """Fetch at most five candidates within the configured search extent and country."""
        policy = self.policy
        country = country or self._country()
        west, south, east, north = policy.search_extent
        params = urllib.parse.urlencode({'q': query, 'format': 'jsonv2', 'limit': 5, 'accept-language': 'it', 'countrycodes': country, 'viewbox': f'{west},{north},{east},{south}', 'bounded': 1})
        request = urllib.request.Request(self.provider + '?' + params, headers={'User-Agent': 'EGI/0.2 (interactive directory address search)', 'Accept': 'application/json'})
        context = ssl.create_default_context()
        if Path('/etc/ssl/cert.pem').is_file():
            context.load_verify_locations('/etc/ssl/cert.pem')
        with urllib.request.urlopen(request, context=context, timeout=8) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError('Geocoder response too large')
        return json.loads(raw)

    def search_address(self, query: str, fetch=None) -> list[dict]:
        """Validate, cache and serialize searches; raise on malformed/unavailable provider."""
        query = ' '.join(query.split())
        if not 3 <= len(query) <= 200:
            raise ValueError('Address must contain 3–200 characters')
        country = None if fetch else self._country()
        fetch = fetch or (lambda text: self.fetch_results(text, country))
        scope = self.policy.model_dump_json() + (country or '')
        key = hmac.new(self.key, (self.provider + scope + query.casefold()).encode(), hashlib.sha256).digest()
        with self.lock:
            self._expire_cache(time.monotonic())
            cached = self.cache.get(key)
            if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
                self.cache.move_to_end(key)
                return cached[1]
        self.rate_file.parent.mkdir(parents=True, exist_ok=True, mode=448)
        with self.rate_file.open('a+') as lock:
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
            raise ValueError('Invalid geocoder response')
        results = []
        west, south, east, north = self.policy.search_extent
        for row in raw[:5]:
            lat, lon = (float(row['lat']), float(row['lon']))
            if math.isfinite(lat) and math.isfinite(lon) and (south <= lat <= north) and (west <= lon <= east):
                results.append({'lat': lat, 'lon': lon, 'label': str(row['display_name'])[:400]})
        with self.lock:
            self.cache[key] = (time.monotonic(), results)
            self.cache.move_to_end(key)
            while len(self.cache) > CACHE_LIMIT:
                self.cache.popitem(last=False)
        return results

    def _expire_cache(self, now: float) -> None:
        """Drop expired response memory while its caller owns the cache lock."""
        for key in list(self.cache):
            if now - self.cache[key][0] >= CACHE_SECONDS:
                del self.cache[key]

    def expire_cache(self) -> None:
        """Actively expire response memory; skip a busy tick rather than block the event loop."""
        if self.lock.acquire(blocking=False):
            try:
                self._expire_cache(time.monotonic())
            finally:
                self.lock.release()

    def close(self):
        """Erase this instance's temporary address responses under its cache lock."""
        with self.lock:
            self.cache.clear()
