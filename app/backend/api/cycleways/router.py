"""Validate cycleway HTTP bodies and delegate bounded reads."""
from fastapi import APIRouter, Depends
from .dependencies import owner
from .service import Cycleways
from .schemas import Viewport
router = APIRouter()

@router.post('/api/preview/cycleways')
def cycleways(body: Viewport, module: Cycleways = Depends(owner)):
    """Return the retained infrastructure viewport."""
    return module.view(body)
