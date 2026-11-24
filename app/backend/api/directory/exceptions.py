"""Failures owned by the directory Module."""
from ...exceptions import ApplicationError

class DirectoryError(ApplicationError):
    """A failed directory operation, translated centrally to HTTP."""
