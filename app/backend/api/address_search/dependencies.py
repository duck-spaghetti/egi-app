"""Resolve the address_search Module owned by the requesting application."""
from fastapi import Request

def owner(request: Request):
    """Inject this app's address search behavior, never a module-global instance."""
    return request.app.state.resources.address_search
