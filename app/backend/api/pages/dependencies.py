"""Inject page context preparation and the selected reader through real dependencies."""
from fastapi import Depends, Request
from ..preview.dependencies import subject_source

def owner(request: Request, source=Depends(subject_source)):
    """Use preview substitution only for preview pages; canonical never reads it."""
    resources = request.app.state.resources
    return resources.pages_for(source)
