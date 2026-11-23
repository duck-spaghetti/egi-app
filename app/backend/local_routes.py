"""Serve explicitly enabled local transport/cycle layers from public directory points."""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query
from .runtime import CANONICAL, DIRECTORY
from .preview_dependencies import subjects
from .preview import services
from .transport import ROOTS as TRANSPORT_ROOTS, transport_view_all
from .transit_nearby import group_by_stop, line_sort_key, lines_near_places_all, summary as transit_summary
from .departures import next_departures_all
from .cycleways import cycleways_view
from .osm_rail import ROOT as OSM_RAIL_ROOT, nearby_places as osm_nearby_places, rail_view as osm_rail_view
from .request_schemas import Origin, Viewport, TransportViewport
MAX_DIRECTIONS=4
router=APIRouter()

@router.post("/api/preview/transport")
def preview_transport(body: TransportViewport):
    """Return scheduled transport and explicitly untimed OSM rail independently of services.

    routes (comma-separated route_ids, at most 80) switches to the focus view:
    only those lines, whole, with their stops.
    """
    west, south, east, north, zoom, modes, routes = body.west, body.south, body.east, body.north, body.zoom, body.modes, body.routes
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
    """Return canonical public points or the retained preview points for local transit."""
    if CANONICAL:
        return {place["location_id"]: (place["longitude"], place["latitude"])
                for service in DIRECTORY.snapshot()["services"] if (place := service.get("place"))
                and place.get("location_id") and place.get("longitude") is not None and place.get("latitude") is not None}
    points = {}
    for service in services(rows):
        place = service.get("place") or {}
        geometry = place.get("geometry") or {}
        if place.get("id") and geometry.get("type") == "Point":
            lon, lat = geometry["coordinates"]
            points[place["id"]] = (lon, lat)
    return points


@router.get("/api/preview/transit/places")
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


@router.get("/api/preview/transit/places/{place_id}")
def transit_place(place_id: str, rows: list[dict[str, Any]] = Depends(subjects)):
    """Destination access: distance-ordered stops/lines, without origin countdowns."""
    points = place_points(rows)
    if place_id not in points:
        raise HTTPException(404, "Luogo senza coordinate nella preview")
    result = nearby_transit({place_id: points[place_id]})
    result["lines"] = result.pop("places").get(place_id, [])
    result["stops"] = group_by_stop(result["lines"])
    return result


@router.post("/api/preview/transit/origin")
def transit_origin(body: Origin):
    """Departures near an explicitly selected Rome-area origin, without DB access."""
    lat, lon = body.lat, body.lon
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


@router.get("/api/preview/transit/departures")
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


@router.post("/api/preview/cycleways")
def preview_cycleways(body: Viewport):
    """OpenStreetMap cycle infrastructure in the viewport (from zoom 12)."""
    west, south, east, north, zoom = body.west, body.south, body.east, body.north, body.zoom
    if west >= east or south >= north:
        raise HTTPException(422, "Viewport non valido")
    return cycleways_view([west, south, east, north], zoom)


