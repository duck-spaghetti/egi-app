"""Validate transport HTTP requests and delegate behavior."""
from typing import Any
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from .dependencies import owner
from .service import Transport
from .schemas import Origin, TransportViewport, VehicleViewport
router = APIRouter()

@router.post('/api/preview/transport')
def preview_transport(body: TransportViewport, owner: Transport=Depends(owner)):
    """Return scheduled transport and explicitly untimed OSM rail independently of services.

routes (comma-separated route_ids, at most 80) switches to the focus view:
only those lines, whole, with their stops."""
    return owner.preview_transport(body)

@router.get('/api/preview/transit/places')
def transit_places(owner: Transport=Depends(owner)):
    """List badges for located places, including explicitly untimed nearby rail."""
    return owner.transit_places()

@router.get('/api/preview/transit/places/{place_id}')
def transit_place(place_id: str, owner: Transport=Depends(owner)):
    """Destination access: distance-ordered stops/lines, without origin countdowns."""
    return owner.transit_place(place_id)

@router.post('/api/preview/transit/origin')
def transit_origin(body: Origin, owner: Transport=Depends(owner)):
    """Departures near an explicitly selected Rome-area origin, without DB access."""
    return owner.transit_origin(body)

@router.get('/api/preview/transit/departures')
def transit_departures(stops: str=Query(min_length=1, max_length=2000), routes: str | None=Query(default=None, max_length=2000), limit: int=Query(default=3, ge=1, le=10), owner: Transport=Depends(owner)):
    """Next scheduled departures at stops (comma-separated stop_ids, at most 40)."""
    return owner.transit_departures(stops, routes, limit)


@router.post('/api/preview/transit/vehicles')
def transit_vehicles(body: VehicleViewport, request: Request):
    """Read latest positions without a database dependency, request log or persistent state."""
    cfg = request.app.state.resources.configuration
    west, south, east, north = cfg.policy.search_extent
    if not (west <= body.west < body.east <= east and south <= body.south < body.north <= north):
        from .exceptions import TransportError
        raise TransportError(422, code='invalid_request')
    from .vehicles import positions
    return positions(cfg.transport_roots[0], (body.west, body.south, body.east, body.north), body.lines)
