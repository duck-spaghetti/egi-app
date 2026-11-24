"""Failures owned by the address_search Module."""
from ...exceptions import ApplicationError

class AddressSearchError(ApplicationError):
    """A failed address search operation, translated centrally to HTTP."""
