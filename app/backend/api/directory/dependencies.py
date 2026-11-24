"""Resolve the directory Module owned by the requesting application."""
from fastapi import Request

def directory(request: Request):
    """Inject this app's directory behavior, never a module-global instance."""
    return request.app.state.resources.directory
