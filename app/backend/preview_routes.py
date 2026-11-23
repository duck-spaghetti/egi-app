"""Retain private evidence/debug routes only when the preview mode is selected."""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from .runtime import templates
from .preview_dependencies import subjects
from . import taxonomy
from .preview import AREA, LANGUAGES, debug_positions, is_map_row, services, source_list
from .presentation import coverage
from .review import overlap_pairs
router=APIRouter()

@router.get("/api/preview/services")
def preview_services(
    area_id: int = 1,
    language: str = "it",
    limit: int = Query(default=2000, ge=1, le=5000),
    include_unplaced: bool = False,
    rows: list[dict[str, Any]] = Depends(subjects),
):
    """Return imported subjects only, never claim canonical approval or live availability.

    Services without a map point are left out (user decision, 2026-11-09) unless
    include_unplaced is set, which the review/debug view uses. Remote directory
    services (telephone/online) have no place by nature and are always kept.
    """
    if area_id != 1:
        raise HTTPException(404, "Area non disponibile nella preview")
    cards = services(rows)
    if not include_unplaced:
        cards = [c for c in cards if is_placed(c)]
    return cards[:limit]


def is_placed(card: dict[str, Any]) -> bool:
    """A card is shown when it has a map point or is a remote directory service."""
    return bool((card.get("place") or {}).get("geometry")) or (card.get("placement") or {}).get("section") == "directory"


@router.get("/api/preview/categories")
def preview_categories(rows: list[dict[str, Any]] = Depends(subjects)):
    """Return the need tiles of the presentation taxonomy (v0.3) for the filters."""
    return taxonomy.need_categories()


@router.get("/api/preview/taxonomy")
def preview_taxonomy():
    """Presentation vocabulary v0.3: need tiles, offers, audiences, access, meal times and paths."""
    return taxonomy.public_vocabulary()


@router.get("/api/preview/languages")
def preview_languages():
    """Return recovered UI catalog languages, independently of source content language."""
    return LANGUAGES


@router.get("/api/preview/areas")
def preview_areas():
    """Return explicit preview framing, without creating canonical territory entities."""
    return [AREA]


@router.get("/api/preview/category-translations")
def category_translations():
    """Keep native labels where no reviewed category translation exists."""
    return []


@router.get("/api/preview/coverage")
def source_coverage(rows: list[dict[str, Any]] = Depends(subjects)):
    """Report native field conservation and use without confusing completeness with accuracy."""
    return coverage(helpinet_rows(rows))


def helpinet_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The coverage benchmark measures Helpinet's native fields only."""
    return [r for r in rows if not is_map_row(r)]


@router.get("/api/preview/debug/sources")
def debug_sources(rows: list[dict[str, Any]] = Depends(subjects)):
    """List displayed sources for the local position-check view (map ?debug=1)."""
    return source_list(rows)


@router.get("/api/preview/debug/positions")
def debug_source_positions(source: str = Query(min_length=1, max_length=80), rows: list[dict[str, Any]] = Depends(subjects)):
    """All position candidates of one source, including those not shown as map points."""
    result = debug_positions(rows, source)
    if not result["total"]:
        raise HTTPException(404, "Fonte non presente nella preview")
    return result


@router.get("/api/preview/review/overlaps")
def review_overlaps(tiers: str = Query(default="A,B,C,D", max_length=10), rows: list[dict[str, Any]] = Depends(subjects)):
    """Cross-dataset candidate pairs among visible services (placed or not), for the duplicate review page."""
    wanted = {t for t in tiers.split(",") if t in {"A", "B", "C", "D"}}
    pairs = [p for p in overlap_pairs(services(rows)) if p["tier"] in wanted]
    groups = {p["group"]["id"]: p["group"] for p in pairs if p.get("group")}
    return {"pairs": pairs, "count": len(pairs), "groups": len(groups),
            "groups_over_two_sources": sum(1 for g in groups.values() if len(g["sources"]) > 2),
            "note": "Coppie da fonti diverse o da capitoli diversi della stessa guida; le decisioni restano nel browser finché non vengono registrate dal curatore."}


@router.get("/revisione/doppioni", response_class=HTMLResponse)
def review_page(request: Request):
    """Local review page: overlapping services side by side, answers kept in the browser."""
    return templates.TemplateResponse(request=request, name="review_overlaps.html", context={})


@router.get("/benchmark", response_class=HTMLResponse)
def benchmark_page(request: Request, rows: list[dict[str, Any]] = Depends(subjects)):
    """Render the inspectable Helpinet field coverage and unresolved source gaps."""
    return templates.TemplateResponse(
        request=request, name="benchmark.html", context={"report": coverage(helpinet_rows(rows))}
    )


