"""Serve the recovered EGI frontend against a read-only local source preview."""

from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from pydantic import BaseModel, Field

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .geocoding import search_address
from .media import MediaCatalog, enabled as media_enabled, representation, sensitivity
from .preview import AREA, LANGUAGES, categories, debug_positions, is_map_row, services, source_list
from .presentation import coverage
from .subjects import PostgresSubjectSource, SubjectSource, SubjectSourceUnavailable
from .transport import ROOTS as TRANSPORT_ROOTS, transport_view_all
from .transit_nearby import group_by_stop, line_sort_key, lines_near_places_all, summary as transit_summary
from .departures import next_departures_all
from .cycleways import cycleways_view
from .osm_rail import ROOT as OSM_RAIL_ROOT, nearby_places as osm_nearby_places, rail_view as osm_rail_view

ROOT = Path(__file__).resolve().parents[2]
app = FastAPI(title="EGI v0.2 — local source preview", version="0.2.0")
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"],
)
# Transport GeoJSON and the service list are megabytes of repetitive JSON.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
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
            "media_enabled": media_enabled(),
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
    modes: str = "metro,rail,tram,bus",
    routes: str | None = Query(default=None, max_length=2000),
):
    """Return scheduled transport and explicitly untimed OSM rail independently of services.

    routes (comma-separated route_ids, at most 80) switches to the focus view:
    only those lines, whole, with their stops.
    """
    selected = set(modes.split(","))
    if west >= east or south >= north or not selected <= {"metro", "rail", "tram", "bus"}:
        raise HTTPException(422, "Viewport o modalità TPL non validi")
    focus = {r for r in routes.split(",") if r} if routes is not None else None
    if focus is not None and not 0 < len(focus) <= 80:
        raise HTTPException(422, "Elenco linee non valido")
    bbox = [west, south, east, north]
    result = transport_view_all(bbox, zoom, selected, TRANSPORT_ROOTS, routes=focus)
    osm = osm_rail_view(bbox, zoom, selected, focus, OSM_RAIL_ROOT)
    result["features"].extend(osm["features"])
    result["sources"].append({k: v for k, v in osm.items() if k != "features"})
    result["osm_rail"] = {k: v for k, v in osm.items() if k != "features"}
    if osm["availability"] == "available":
        result["availability"] = "available"
    return result


def place_points(rows: list[dict[str, Any]]) -> dict[str, tuple[float, float]]:
    """Map each located place of the imported services to its source coordinates."""
    points = {}
    for service in services(rows):
        place = service.get("place") or {}
        geometry = place.get("geometry") or {}
        if place.get("id") and geometry.get("type") == "Point":
            lon, lat = geometry["coordinates"]
            points[place["id"]] = (lon, lat)
    return points


@app.get("/api/preview/transit/places")
def transit_places(rows: list[dict[str, Any]] = Depends(subjects)):
    """List badges for located places, including explicitly untimed nearby rail."""
    result = nearby_transit(place_points(rows))
    result["places"] = {k: transit_summary(v) for k, v in result["places"].items()}
    return result


def nearby_transit(points: dict[str, tuple[float, float]]) -> dict:
    """Merge timed nearby lines with OSM station rows, preserving source availability."""
    result = lines_near_places_all(points, TRANSPORT_ROOTS)
    osm = osm_nearby_places(points, OSM_RAIL_ROOT)
    result["sources"].append({k: v for k, v in osm.items() if k not in {"places", "method"}})
    if osm["availability"] == "available":
        result["availability"] = "available"
    for place_id, rows in osm["places"].items():
        result["places"].setdefault(place_id, []).extend(rows)
        result["places"][place_id].sort(key=line_sort_key)
    return result


MAX_DIRECTIONS = 4


def upcoming_directions(directions: list[dict]) -> list[dict]:
    """Directions that still have trips, soonest first, at most MAX_DIRECTIONS.

    A busy station (Termini) has dozens of train destinations; only the next few
    matter. If none has a further trip today, one empty entry says so.
    """
    def first(d):
        """Minutes to the next trip, realtime first."""
        times = (d.get("realtime") or d["times"])[:1]
        return times[0]["in_min"] if times else None

    live = sorted((d for d in directions if first(d) is not None), key=first)
    if live:
        return live[:MAX_DIRECTIONS]
    return directions[:1]


@app.get("/api/preview/transit/places/{place_id}")
def transit_place(place_id: str, rows: list[dict[str, Any]] = Depends(subjects)):
    """Destination access: distance-ordered stops/lines, without origin countdowns."""
    points = place_points(rows)
    if place_id not in points:
        raise HTTPException(404, "Luogo senza coordinate nella preview")
    result = nearby_transit({place_id: points[place_id]})
    result["lines"] = result.pop("places").get(place_id, [])
    result["stops"] = group_by_stop(result["lines"])
    return result


@app.get("/api/preview/transit/origin")
def transit_origin(
    lat: float = Query(ge=41.0, le=42.7),
    lon: float = Query(ge=11.5, le=13.7),
):
    """Departures near an explicitly selected Rome-area origin, without DB access."""
    result = nearby_transit({"origin": (lon, lat)})
    result["lines"] = lines = result.pop("places").get("origin", [])
    # Next scheduled departures of each row's line at its nearest stop.
    timed = [row for row in lines if not row.get("untimed")]
    schedule = next_departures_all(
        sorted({stop for row in timed for stop in row["stop_ids"]}),
        {row["route_id"] for row in timed},
        2,
        TRANSPORT_ROOTS,
    )
    by_stop_route: dict[tuple, list] = {}
    for departure in schedule["departures"]:
        by_stop_route.setdefault((departure["stop_id"], departure["route_id"]), []).append(departure)
    for row in lines:
        directions: dict[tuple, dict] = {}
        for stop in row["stop_ids"]:
            for departure in by_stop_route.get((stop, row["route_id"]), []):
                key = (departure["direction_id"], departure["headsign"])
                if key not in directions or (
                    departure["times"]
                    and (not directions[key]["times"] or departure["times"][0]["in_min"] < directions[key]["times"][0]["in_min"])
                ):
                    directions[key] = {
                        "headsign": departure["headsign"],
                        "direction_id": departure["direction_id"],
                        "times": departure["times"],
                        "realtime": departure["realtime"],
                    }
                elif departure["realtime"] and not directions[key]["realtime"]:
                    directions[key]["realtime"] = departure["realtime"]
        row["next"] = upcoming_directions(list(directions.values()))
    result["stops"] = group_by_stop(lines)
    result["schedule_availability"] = schedule["availability"]
    result["realtime"] = schedule["realtime"]
    result["alerts"] = schedule["alerts"]
    result["now"] = schedule["now"]
    return result


@app.get("/api/preview/transit/departures")
def transit_departures(
    stops: str = Query(min_length=1, max_length=2000),
    routes: str | None = Query(default=None, max_length=2000),
    limit: int = Query(default=3, ge=1, le=10),
):
    """Next scheduled departures at stops (comma-separated stop_ids, at most 40)."""
    stop_ids = [s for s in stops.split(",") if s]
    if not 0 < len(stop_ids) <= 40:
        raise HTTPException(422, "Elenco fermate non valido")
    route_ids = {r for r in routes.split(",") if r} if routes else None
    return next_departures_all(stop_ids, route_ids, limit, TRANSPORT_ROOTS)


@app.get("/api/preview/cycleways")
def preview_cycleways(
    west: float = Query(ge=-180, le=180),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90),
    zoom: int = Query(ge=0, le=19),
):
    """OpenStreetMap cycle infrastructure in the viewport (from zoom 12)."""
    if west >= east or south >= north:
        raise HTTPException(422, "Viewport non valido")
    return cycleways_view([west, south, east, north], zoom)


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
    return coverage(helpinet_rows(rows))


def helpinet_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The coverage benchmark measures Helpinet's native fields only."""
    return [r for r in rows if not is_map_row(r)]


@app.get("/api/preview/debug/sources")
def debug_sources(rows: list[dict[str, Any]] = Depends(subjects)):
    """List displayed sources for the local position-check view (map ?debug=1)."""
    return source_list(rows)


MEDIA_CATALOG = MediaCatalog()
_SERVICE_INDEX: dict[int, dict[str, dict[str, Any]]] = {}


def service_by_id(rows: list[dict[str, Any]], service_id: str) -> dict[str, Any] | None:
    """Look a card up by id, reusing the index while the subject snapshot is unchanged."""
    key = id(rows)
    if key not in _SERVICE_INDEX:
        _SERVICE_INDEX.clear()
        _SERVICE_INDEX[key] = {s["id"]: s for s in services(rows)}
    return _SERVICE_INDEX[key].get(service_id)


@app.get("/api/preview/media")
def service_media(service: str = Query(min_length=1, max_length=80), rows: list[dict[str, Any]] = Depends(subjects)):
    """How to represent one service: priority organisation > Mapillary > user; Street View on request."""
    card = service_by_id(rows, service)
    if card is None:
        raise HTTPException(404, "Servizio non disponibile")
    return representation(card, MEDIA_CATALOG)


MAPILLARY_CANDIDATES = Path(__file__).resolve().parents[3] / ".local/mapillary/candidates.json"


@app.get("/api/preview/debug/mapillary")
def debug_mapillary(rows: list[dict[str, Any]] = Depends(subjects)):
    """Phase-1 Mapillary test: ranked image candidates for the sampled POIs.

    Metadata only, produced by .scratch/mapillary/coverage.py; images are shown through
    Mapillary's own embed viewer, never downloaded or stored by EGI.
    """
    try:
        data = json.loads(MAPILLARY_CANDIDATES.read_text())
    except (OSError, ValueError):
        return {"available": False, "pois": {}}
    # Sensitive services are excluded from images everywhere, debug included.
    kept = {}
    for poi_id, entry in data.get("pois", {}).items():
        card = service_by_id(rows, poi_id)
        if card is None or not sensitivity(card):
            kept[poi_id] = entry
    data["excluded_sensitive"] = len(data.get("pois", {})) - len(kept)
    data["pois"] = kept
    return {"available": True, **data}


@app.get("/api/preview/debug/positions")
def debug_source_positions(source: str = Query(min_length=1, max_length=80), rows: list[dict[str, Any]] = Depends(subjects)):
    """All position candidates of one source, including those not shown as map points."""
    result = debug_positions(rows, source)
    if not result["total"]:
        raise HTTPException(404, "Fonte non presente nella preview")
    return result


@app.get("/benchmark", response_class=HTMLResponse)
def benchmark_page(request: Request, rows: list[dict[str, Any]] = Depends(subjects)):
    """Render the inspectable Helpinet field coverage and unresolved source gaps."""
    return templates.TemplateResponse(
        request=request, name="benchmark.html", context={"report": coverage(helpinet_rows(rows))}
    )


class AddressSearch(BaseModel):
    """Explicit search text; POST keeps the address out of ordinary URL access logs."""

    query: str = Field(min_length=3, max_length=200)


@app.post("/api/preview/address-search")
def address_search(body: AddressSearch):
    """Resolve a submitted public address; never expose upstream error/query details."""
    if len(body.query.strip()) < 3:
        raise HTTPException(422, "Inserisci almeno tre caratteri")
    try:
        return {"results": search_address(body.query), "attribution": "© OpenStreetMap contributors"}
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        raise HTTPException(503, "Ricerca indirizzo non disponibile. Scegli un punto sulla mappa.") from None
