"""Prepare the existing address-search response independently of HTTP."""
import urllib.error
from .exceptions import AddressSearchError

class AddressSearch:
    """Hide upstream lookup errors and preserve explicit empty results."""
    def __init__(self, geocoder):
        """Accept the per-application lookup dependency."""
        self.geocoder = geocoder

    def search(self, query):
        """Return bounded candidates or a safe upstream availability failure."""
        try:
            return {'results': self.geocoder.search_address(query), 'attribution': '© OpenStreetMap contributors'}
        except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
            raise AddressSearchError(503, code='upstream_unavailable') from None
