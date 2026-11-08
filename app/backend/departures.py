"""Next scheduled departures from the active version's departures.sqlite.

next_departures(root, stop_ids, ...) returns, per line direction calling at the
given stops, the next scheduled times from "now" (Europe/Rome), including trips of
yesterday's service day that run after midnight. Read-only; no realtime claim.
Format: egi-importer/docs/transport-format.md, section departures.sqlite.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .transit_nearby import display_code, stop_index
from .transport import ROOT, load_active

ROME = ZoneInfo("Europe/Rome")
MAX_STOPS = 200  # a busy place: ~50 lines × a few same-named stops


def clock(minutes: int) -> str:
    """Format minutes after midnight as HH:MM, wrapping past 24:00."""
    return f"{(minutes // 60) % 24:02d}:{minutes % 60:02d}"


def query_departures(path: Path, stop_ids: list[str], route_ids: set[str] | None):
    """Yield (stop_id, route_id, direction_id, headsign, service_id, [minutes])."""
    marks = ",".join("?" * len(stop_ids))
    sql = (
        "SELECT d.stop_id, p.route_id, p.direction_id, p.headsign, s.service_id, d.minutes"
        " FROM departures d JOIN patterns p ON p.id = d.pattern_id"
        f" JOIN services s ON s.id = d.service WHERE d.stop_id IN ({marks})"
    )
    db = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        for stop, route, direction, headsign, service, minutes in db.execute(sql, stop_ids):
            if route_ids is None or route in route_ids:
                yield stop, route, direction, headsign, service, [int(m) for m in minutes.split(",")]
    finally:
        db.close()


def next_departures(
    stop_ids: list[str],
    route_ids: set[str] | None = None,
    limit: int = 3,
    root: Path | None = None,
    now: datetime | None = None,
) -> dict:
    """Next `limit` scheduled times per (stop, line, direction) from now.

    Returns {"availability", "service_date", "now", "departures": [...]}, where each
    departure has stop_id, route_id, code, mode, direction_id, headsign and times
    [{"time": "HH:MM", "in_min": n}]. Directions with no further trip today are
    listed with an empty times list, so "no more trips" is explicit.
    """
    moment = (now or datetime.now(ROME)).astimezone(ROME)
    today = moment.date()
    now_min = moment.hour * 60 + moment.minute
    result = {
        "availability": "unavailable",
        "service_date": today.isoformat(),
        "now": clock(now_min),
        "departures": [],
    }
    try:
        manifest, _status, network = load_active(root or ROOT, today.isoformat())
        path = (root or ROOT) / "versions" / manifest["version"] / "departures.sqlite"
        if not path.is_file():
            return result
        dates = network["service_dates"]
        active_today = set(dates.get(today.isoformat(), []))
        active_yesterday = set(dates.get((today - timedelta(days=1)).isoformat(), []))
        groups: dict[tuple, list[int]] = {}
        for stop, route, direction, headsign, service, minutes in query_departures(
            path, stop_ids[:MAX_STOPS], route_ids
        ):
            if route not in network["routes"]:
                continue
            key = (stop, route, direction, headsign)
            times = groups.setdefault(key, [])
            if service in active_today:
                times.extend(m for m in minutes if m >= now_min)
            if service in active_yesterday:
                times.extend(m - 1440 for m in minutes if m - 1440 >= now_min)
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        return result
    colors = stop_index(manifest["version"], network).colors
    departures = []
    for (stop, route, direction, headsign), times in groups.items():
        mode = network["routes"][route]["mode"]
        upcoming = sorted(set(times))[:limit]
        departures.append(
            {
                "stop_id": stop,
                "route_id": route,
                "code": display_code(network["routes"][route]["code"], mode),
                "mode": mode,
                "color": colors.get(route),
                "direction_id": direction,
                "headsign": headsign,
                "times": [{"time": clock(m), "in_min": m - now_min} for m in upcoming],
            }
        )
    departures.sort(key=lambda d: (d["times"][0]["in_min"] if d["times"] else 10**6, d["code"], d["headsign"]))
    result.update(availability="available", departures=departures)
    return result
