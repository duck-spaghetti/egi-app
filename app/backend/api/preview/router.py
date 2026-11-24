"""Validate preview HTTP requests and delegate behavior."""
from typing import Any
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from .dependencies import owner, subjects
from .service import Preview
from .schemas import PreviewSelection

router = APIRouter()

@router.get('/api/preview/services')
def preview_services(area_id: int=1, language: str='it', limit: int=Query(default=2000, ge=1, le=5000), include_unplaced: bool=False, rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """Return imported subjects only, never claim canonical approval or live availability.

Services without a map point are left out (user decision, 2026-11-09) unless
include_unplaced is set, which the review/debug view uses. Remote directory
services (telephone/online) have no place by nature and are always kept."""
    return owner.preview_services(PreviewSelection(area_id=area_id,language=language,limit=limit,include_unplaced=include_unplaced),rows)

@router.get('/api/preview/categories')
def preview_categories(rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """Return the need tiles of the presentation taxonomy (v0.3) for the filters."""
    return owner.preview_categories(rows)

@router.get('/api/preview/taxonomy')
def preview_taxonomy(owner: Preview=Depends(owner)):
    """Presentation vocabulary v0.3: need tiles, offers, audiences, access, meal times and paths."""
    return owner.preview_taxonomy()

@router.get('/api/preview/languages')
def preview_languages(owner: Preview=Depends(owner)):
    """Return recovered UI catalog languages, independently of source content language."""
    return owner.preview_languages()

@router.get('/api/preview/areas')
def preview_areas(owner: Preview=Depends(owner)):
    """Return explicit preview framing, without creating canonical territory entities."""
    return owner.preview_areas()

@router.get('/api/preview/category-translations')
def category_translations(owner: Preview=Depends(owner)):
    """Keep native labels where no reviewed category translation exists."""
    return owner.category_translations()

@router.get('/api/preview/coverage')
def source_coverage(rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """Report native field conservation and use without confusing completeness with accuracy."""
    return owner.source_coverage(rows)

@router.get('/api/preview/debug/sources')
def debug_sources(rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """List displayed sources for the local position-check view (map ?debug=1)."""
    return owner.debug_sources(rows)

@router.get('/api/preview/debug/positions')
def debug_source_positions(source: str=Query(min_length=1, max_length=80), rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """All position candidates of one source, including those not shown as map points."""
    return owner.debug_source_positions(source, rows)

@router.get('/api/preview/review/overlaps')
def review_overlaps(tiers: str=Query(default='A,B,C,D', max_length=10), rows: list[dict[str, Any]]=Depends(subjects), owner: Preview=Depends(owner)):
    """Cross-dataset candidate pairs among visible services (placed or not), for the duplicate review page."""
    return owner.review_overlaps(tiers, rows)

@router.get('/revisione/doppioni', response_class=HTMLResponse)
def review_page(request: Request):
    """Render only the preview overlap-review shell."""
    return request.app.state.resources.templates.TemplateResponse(request=request, name='pages/review_overlaps.html', context={})

@router.get('/benchmark', response_class=HTMLResponse)
def benchmark_page(request: Request, rows: list[dict[str, Any]] = Depends(subjects), module: Preview = Depends(owner)):
    """Render the existing source-coverage report."""
    return request.app.state.resources.templates.TemplateResponse(request=request, name='pages/benchmark.html', context={'report': module.source_coverage(rows)})
