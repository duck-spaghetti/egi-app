"""Resolve the cycleways Module owned by the requesting application."""
from fastapi import Request

def owner(request: Request):
    """Inject this app's cycleways behavior, never a module-global instance."""
    return request.app.state.resources.cycleways
