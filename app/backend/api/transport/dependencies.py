"""Inject actual canonical or source-preview point providers into local transport."""
from fastapi import Depends, Request
from ..preview.dependencies import subject_source

def owner(request: Request, source=Depends(subject_source)):
    """Supply points from the selected reader without a mode flag in transport behavior."""
    resources = request.app.state.resources
    return resources.transport_for(source)
