"""Render entry/map pages and health for the selected public or preview reader."""
from types import SimpleNamespace
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from .runtime import CANONICAL, DIRECTORY, LOCAL_LAYERS, templates
from .preview_dependencies import subject_source, subjects
from .subjects import SubjectSource
from .preview import LANGUAGES
from .app_profile import resolved
router=APIRouter()

@router.get("/", response_class=HTMLResponse)
def entry(request: Request):
    """Render the language/city wizard with the selected directory mode."""
    return templates.TemplateResponse(request=request, name="entry.html", context={
        "canonical": CANONICAL, "api_base": "/api/public" if CANONICAL else "/api/preview", "profile":resolved()})


@router.get("/map", response_class=HTMLResponse)
def map_page(request: Request, city_id: int = 1, lang: str = "it"):
    """Render the recovered map shell for the local Rome source collection."""
    if city_id != 1:
        raise HTTPException(404, "Area non disponibile nella preview")
    language = next((x for x in LANGUAGES if x["code"] == lang), LANGUAGES[0])
    config=resolved(DIRECTORY.snapshot(lang)['territory'] if CANONICAL else None)
    west,south,east,north=config['bounds']
    city=SimpleNamespace(id=1,name=config['name'],slug=config['territory_code'],
        center_lat=config['center'][1],center_lng=config['center'][0],default_zoom=config['zoom'],
        bbox_north=north,bbox_south=south,bbox_east=east,bbox_west=west)
    return templates.TemplateResponse(
        request=request,
        name="map.html",
        context={
            "city": city,
            "language": SimpleNamespace(**language),
            "lang": language["code"],
            "canonical": CANONICAL,
            "api_base": "/api/public" if CANONICAL else "/api/preview",
            "local_layers": LOCAL_LAYERS if CANONICAL else True,
            "profile": config,
        },
    )


@router.get("/health")
def health(source: SubjectSource = Depends(subject_source)):
    """Report the selected directory mode and count through its configured reader."""
    if CANONICAL:
        return {"status": "ok", "mode": "canonical-local", "services": len(DIRECTORY.snapshot()["services"])}
    rows = subjects(source)
    return {
        "status": "ok",
        "mode": "local-unreviewed-preview",
        "services": len(rows),
    }


@router.get("/contribuisci", response_class=HTMLResponse)
def contribute():
    """Explain read-only scope instead of exposing incompatible old mutation forms."""
    return '<h1>EGI v0.1 — preview locale</h1><p>La modifica dei dati non è ancora disponibile.</p><a href="/map">Torna alla mappa</a>'


