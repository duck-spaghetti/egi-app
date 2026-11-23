"""Own transport behavior independently of HTTP request handling."""
from typing import Any
from .network import transport_view_all
from .nearby import group_by_stop, line_sort_key, lines_near_places_all, summary as transit_summary
from .departures import next_departures_all
from .osm_rail import nearby_places as osm_nearby_places, rail_view as osm_rail_view
from .schemas import Origin, TransportViewport
MAX_DIRECTIONS = 4
from .exceptions import TransportError

class Transport:
    """Hide transport orchestration behind its actual operations."""
    def __init__(self, points, roots, osm_root, policy):
        """Accept the selected public-point provider and actual local data roots."""
        self.points, self.roots, self.osm_root, self.policy = points, roots, osm_root, policy


    def preview_transport(self, body: TransportViewport):
        """Return scheduled transport and explicitly untimed OSM rail independently of services.

        routes (comma-separated route_ids, at most 80) switches to the focus view:
        only those lines, whole, with their stops.
        """
        self.validate_extent((body.west, body.south, body.east, body.north))
        west, south, east, north, zoom, modes, routes = (body.west, body.south, body.east, body.north, body.zoom, body.modes, body.routes)
        selected = set(modes.split(','))
        if west >= east or south >= north or (not selected <= {'metro', 'rail', 'tram', 'bus'}):
            raise TransportError(422, 'Viewport o modalità TPL non validi')
        focus = {r for r in routes.split(',') if r} if routes is not None else None
        if focus is not None and (not 0 < len(focus) <= 80):
            raise TransportError(422, 'Elenco linee non valido')
        bbox = [west, south, east, north]
        result = transport_view_all(bbox, zoom, selected, self.roots, routes=focus)
        osm = osm_rail_view(bbox, zoom, selected, focus, self.osm_root)
        result['features'].extend(osm['features'])
        result['sources'].append({k: v for k, v in osm.items() if k != 'features'})
        result['osm_rail'] = {k: v for k, v in osm.items() if k != 'features'}
        if osm['availability'] == 'available':
            result['availability'] = 'available'
        return result

    def transit_places(self):
        """List badges for located places, including explicitly untimed nearby rail."""
        result = self.nearby_transit(self.points())
        result['places'] = {k: transit_summary(v) for k, v in result['places'].items()}
        return result

    def nearby_transit(self, points: dict[str, tuple[float, float]]) -> dict:
        """Merge timed nearby lines with OSM station rows, preserving source availability."""
        result = lines_near_places_all(points, self.roots)
        osm = osm_nearby_places(points, self.osm_root)
        result['sources'].append({k: v for k, v in osm.items() if k not in {'places', 'method'}})
        if osm['availability'] == 'available':
            result['availability'] = 'available'
        for place_id, rows in osm['places'].items():
            result['places'].setdefault(place_id, []).extend(rows)
            result['places'][place_id].sort(key=line_sort_key)
        return result

    @staticmethod
    def upcoming_directions(directions: list[dict]) -> list[dict]:
        """Directions that still have trips, soonest first, at most MAX_DIRECTIONS.

        A busy station (Termini) has dozens of train destinations; only the next few
        matter. If none has a further trip today, one empty entry says so.
        """

        def first(d):
            """Minutes to the next trip, realtime first."""
            times = (d.get('realtime') or d['times'])[:1]
            return times[0]['in_min'] if times else None
        live = sorted((d for d in directions if first(d) is not None), key=first)
        if live:
            return live[:MAX_DIRECTIONS]
        return directions[:1]

    def transit_place(self, place_id: str):
        """Destination access: distance-ordered stops/lines, without origin countdowns."""
        points = self.points()
        if place_id not in points:
            raise TransportError(404, 'Luogo senza coordinate nella preview')
        result = self.nearby_transit({place_id: points[place_id]})
        result['lines'] = result.pop('places').get(place_id, [])
        result['stops'] = group_by_stop(result['lines'])
        return result

    def transit_origin(self, body: Origin):
        """Departures near an explicitly selected Rome-area origin, without DB access."""
        self.validate_point(body.lon, body.lat)
        lat, lon = (body.lat, body.lon)
        result = self.nearby_transit({'origin': (lon, lat)})
        result['lines'] = lines = result.pop('places').get('origin', [])
        timed = [row for row in lines if not row.get('untimed')]
        schedule = next_departures_all(sorted({stop for row in timed for stop in row['stop_ids']}), {row['route_id'] for row in timed}, 2, self.roots)
        by_stop_route: dict[tuple, list] = {}
        for departure in schedule['departures']:
            by_stop_route.setdefault((departure['stop_id'], departure['route_id']), []).append(departure)
        for row in lines:
            directions: dict[tuple, dict] = {}
            for stop in row['stop_ids']:
                for departure in by_stop_route.get((stop, row['route_id']), []):
                    key = (departure['direction_id'], departure['headsign'])
                    if key not in directions or (departure['times'] and (not directions[key]['times'] or departure['times'][0]['in_min'] < directions[key]['times'][0]['in_min'])):
                        directions[key] = {'headsign': departure['headsign'], 'direction_id': departure['direction_id'], 'times': departure['times'], 'realtime': departure['realtime']}
                    elif departure['realtime'] and (not directions[key]['realtime']):
                        directions[key]['realtime'] = departure['realtime']
            row['next'] = self.upcoming_directions(list(directions.values()))
        result['stops'] = group_by_stop(lines)
        result['schedule_availability'] = schedule['availability']
        result['realtime'] = schedule['realtime']
        result['alerts'] = schedule['alerts']
        result['now'] = schedule['now']
        return result

    def transit_departures(self, stops: str, routes: str | None, limit: int):
        """Next scheduled departures at stops (comma-separated stop_ids, at most 40)."""
        stop_ids = [s for s in stops.split(',') if s]
        if not 0 < len(stop_ids) <= 40:
            raise TransportError(422, 'Elenco fermate non valido')
        route_ids = {r for r in routes.split(',') if r} if routes else None
        return next_departures_all(stop_ids, route_ids, limit, self.roots)

    def validate_extent(self, bounds):
        """Enforce this application's configured search extent."""
        w, s, e, n = self.policy.search_extent
        west, south, east, north = bounds
        if not (w <= west < east <= e and s <= south < north <= n):
            raise TransportError(422, code='invalid_request')

    def validate_point(self, lon, lat):
        """Reject an origin outside this application's configured area."""
        w, s, e, n = self.policy.search_extent
        if not (w <= lon <= e and s <= lat <= n):
            raise TransportError(422, code='invalid_request')
