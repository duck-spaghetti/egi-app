"""Validate public HTTP selections and delegate directory behavior."""
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from .dependencies import directory
from .schemas import Discovery
from .service import Directory, LANGUAGES
router = APIRouter(prefix='/api/public')

@router.get('/services')
def services(area_id: int = 1, language: str = Query(default='it', max_length=16),
             limit: int = Query(default=2000, ge=1, le=5000), owner: Directory = Depends(directory)):
    """Return approved cards without leaking transport details into behavior."""
    return owner.services(Discovery(area_id=area_id, language=language, limit=limit))

@router.get('/services/{identifier}')
def detail(identifier: UUID, language: str = Query(default='it', max_length=16), owner: Directory = Depends(directory)):
    """Return a selected public card."""
    return owner.detail(identifier, language)

@router.get('/categories')
def categories(language: str = Query(default='it', max_length=16), owner: Directory = Depends(directory)):
    """Return public need categories."""
    return owner.vocabulary(language)['needs']

@router.get('/taxonomy')
def taxonomy(language: str = Query(default='it', max_length=16), owner: Directory = Depends(directory)):
    """Return public labels without private interpretation rules."""
    return owner.vocabulary(language)

@router.get('/areas')
def areas(owner: Directory = Depends(directory)):
    """Return safe configured territory values."""
    return owner.areas()

@router.get('/languages')
def languages():
    """Retain current UI-language metadata."""
    return LANGUAGES

@router.get('/category-translations')
def category_translations():
    """Preserve the existing category translation envelope."""
    return []
