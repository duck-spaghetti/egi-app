"""Failures owned by the preview Module."""
from ...exceptions import ApplicationError

class PreviewError(ApplicationError):
    """A failed preview operation, translated centrally to HTTP."""
