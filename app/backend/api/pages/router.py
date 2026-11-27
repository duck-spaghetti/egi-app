"""Render page shells from prepared contexts and expose selected-reader health."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, FileResponse
from ...config import ROOT
from .dependencies import owner
from .service import Pages
from .schemas import PageSelection, Health
router = APIRouter()

@router.get('/', response_class=HTMLResponse)
def entry(request: Request, module: Pages = Depends(owner)):
    """Render the existing language/city entry page."""
    return request.app.state.resources.templates.TemplateResponse(request=request, name='pages/entry.html', context=module.entry())

@router.get('/map', response_class=HTMLResponse)
def map_page(request: Request, city_id: int = 1, lang: str = 'it', module: Pages = Depends(owner)):
    """Render the selected map without leaking reader configuration."""
    return request.app.state.resources.templates.TemplateResponse(request=request, name='pages/map.html', context=module.map(PageSelection(city_id=city_id, lang=lang)))

@router.get('/health', response_model=Health)
def health(module: Pages = Depends(owner)):
    """Report only the selected reader's health."""
    return module.health()

@router.get('/contribuisci', response_class=HTMLResponse)
def contribute():
    """Retain the read-only explanation; do not invent a contribution journey."""
    return '<h1>EGI v0.1 — preview locale</h1><p>La modifica dei dati non è ancora disponibile.</p><a href="/map">Torna alla mappa</a>'


@router.get('/preferiti', response_class=HTMLResponse)
def favorites(request: Request, module: Pages = Depends(owner)):
    """Serve a public offline shell without reading service or visitor data."""
    return request.app.state.resources.templates.TemplateResponse(
        request=request, name='pages/favorites.html', context=module.entry())


@router.get('/preferiti/liste', response_class=HTMLResponse)
def lists(request: Request, module: Pages = Depends(owner)):
    """Local collection shell; list contents never leave the device."""
    return request.app.state.resources.templates.TemplateResponse(
        request=request, name='pages/lists.html', context=module.entry())


@router.get('/preferiti/sw.js')
def favorites_worker():
    """Serve the dedicated worker with scope restricted to the favorites path."""
    return FileResponse(ROOT / 'app/frontend/static/js/features/favorites/worker.js',
                        media_type='application/javascript',
                        headers={'Service-Worker-Allowed': '/preferiti'})
