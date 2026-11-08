"""Serve the recovered EGI frontend against a read-only local source preview."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .preview import AREA, LANGUAGES, categories, services
from .presentation import coverage
from .subjects import PostgresSubjectSource, SubjectSource, SubjectSourceUnavailable
from .transport import transport_view

ROOT = Path(__file__).resolve().parents[2]
app = FastAPI(title="EGI v0.2 — local source preview", version="0.2.0")
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"],
)
app.mount("/static", StaticFiles(directory=ROOT / "app/frontend/static"), name="static")
app.mount(
    "/translations", StaticFiles(directory=ROOT / "translations"), name="translations"
)
templates = Jinja2Templates(directory=ROOT / "app/frontend/templates")


@app.middleware("http")
async def preview_headers(request: Request, call_next):
    """Mark every response as a private preview and prevent stale cached evidence."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-EGI-Data-Status"] = "unreviewed-source-preview"
    return response


SUBJECT_SOURCE = PostgresSubjectSource()


def subject_source() -> SubjectSource:
    """Return the process-wide subject source; tests override this dependency."""
    return SUBJECT_SOURCE


def subjects(source: SubjectSource = Depends(subject_source)) -> list[dict[str, Any]]:
    """Translate unavailable DB state into an explicit service error instead of an empty map."""
    try:
        return source.latest()
    except SubjectSourceUnavailable as exc:
        raise HTTPException(503, "Database preview non disponibile") from exc


@app.get("/", response_class=HTMLResponse)
def entry(request: Request):
    """Render the original language/city wizard with an explicit preview label."""
    return templates.TemplateResponse(request=request, name="entry.html", context={})


@app.get("/map", response_class=HTMLResponse)
def map_page(request: Request, city_id: int = 1, lang: str = "it"):
    """Render the recovered map shell for the local Rome source collection."""
    if city_id != 1:
        raise HTTPException(404, "Area non disponibile nella preview")
    language = next((x for x in LANGUAGES if x["code"] == lang), LANGUAGES[0])
    city = SimpleNamespace(
        id=1,
        name=AREA["name"],
        slug="roma",
        center_lat=41.9028,
        center_lng=12.4964,
        default_zoom=11,
        bbox_north=42.7,
        bbox_south=41.0,
        bbox_east=13.7,
        bbox_west=11.5,
    )
    return templates.TemplateResponse(
        request=request,
        name="map.html",
        context={
            "city": city,
            "language": SimpleNamespace(**language),
            "lang": language["code"],
        },
    )


@app.get("/api/preview/services")
def preview_services(
    area_id: int = 1,
    language: str = "it",
    limit: int = Query(default=2000, ge=1, le=5000),
    rows: list[dict[str, Any]] = Depends(subjects),
):
    """Return imported subjects only, never claim canonical approval or live availability."""
    if area_id != 1:
        raise HTTPException(404, "Area non disponibile nella preview")
    return services(rows)[:limit]


@app.get("/api/preview/categories")
def preview_categories(rows: list[dict[str, Any]] = Depends(subjects)):
    """Return native source-need presentation groups for the recovered filters."""
    return categories(rows)


@app.get("/api/preview/transport")
def preview_transport(
    west: float = Query(default=12.2, ge=-180, le=180),
    south: float = Query(default=41.7, ge=-90, le=90),
    east: float = Query(default=12.8, ge=-180, le=180),
    north: float = Query(default=42.1, ge=-90, le=90),
    zoom: int = Query(default=11, ge=0, le=19),
    modes: str = "metro,bus",
):
    """Return source-scheduled bus/metro features independently of service data."""
    selected = set(modes.split(","))
    if west >= east or south >= north or not selected <= {"metro", "bus"}:
        raise HTTPException(422, "Viewport o modalità TPL non validi")
    return transport_view([west, south, east, north], zoom, selected)


@app.get("/api/preview/languages")
def preview_languages():
    """Return recovered UI catalog languages, independently of source content language."""
    return LANGUAGES


@app.get("/api/preview/areas")
def preview_areas():
    """Return explicit preview framing, without creating canonical territory entities."""
    return [AREA]


@app.get("/api/preview/category-translations")
def category_translations():
    """Keep native labels where no reviewed category translation exists."""
    return []


@app.get("/health")
def health(rows: list[dict[str, Any]] = Depends(subjects)):
    """Report the imported subject count; the database is checked at most once per cache TTL."""
    return {
        "status": "ok",
        "mode": "local-unreviewed-preview",
        "services": len(rows),
    }


@app.get("/contribuisci", response_class=HTMLResponse)
def contribute():
    """Explain read-only scope instead of exposing incompatible old mutation forms."""
    return '<h1>EGI v0.1 — preview locale</h1><p>La modifica dei dati non è ancora disponibile.</p><a href="/map">Torna alla mappa</a>'


@app.get("/api/preview/coverage")
def source_coverage(rows: list[dict[str, Any]] = Depends(subjects)):
    """Report native field conservation and use without confusing completeness with accuracy."""
    return coverage(rows)


@app.get("/benchmark", response_class=HTMLResponse)
def benchmark_page(request: Request, rows: list[dict[str, Any]] = Depends(subjects)):
    """Render the inspectable Helpinet field coverage and unresolved source gaps."""
    return templates.TemplateResponse(
        request=request, name="benchmark.html", context={"report": coverage(rows)}
    )
