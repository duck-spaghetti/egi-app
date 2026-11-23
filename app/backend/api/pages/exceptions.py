"""Failures owned by the pages Module."""
from ...exceptions import ApplicationError

class PageError(ApplicationError):
    """A failed pages operation, translated centrally to HTTP."""
