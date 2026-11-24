"""Failures owned by the cycleways Module."""
from ...exceptions import ApplicationError

class CyclewaysError(ApplicationError):
    """A failed cycleways operation, translated centrally to HTTP."""
