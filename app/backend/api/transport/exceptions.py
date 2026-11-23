"""Failures owned by the transport Module."""
from ...exceptions import ApplicationError

class TransportError(ApplicationError):
    """A failed transport operation, translated centrally to HTTP."""
