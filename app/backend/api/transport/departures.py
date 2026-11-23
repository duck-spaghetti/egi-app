"""Next departures: scheduled times plus realtime predictions and service alerts.

next_departures(stop_ids, ...) returns, per line direction calling at the given
stops, the next scheduled times from "now" (Europe/Rome), including trips of
yesterday's service day that run after midnight, from the active version's
departures.sqlite. When the realtime snapshot written by the importer's realtime
poller (realtime/latest.json) is fresh, each direction also gets predicted times;
alerts touching the lines or stops are attached. Read-only.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .nearby import local_route, display_code, stop_index
from .network import ROOT, load_active

ROME = ZoneInfo("Europe/Rome")
REALTIME_MAX_AGE_S = 180  # older predictions are not shown as realtime
_realtime_cache: dict = {"mtime": None, "data": None}
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


def load_realtime(root: Path) -> dict | None:
    """Latest realtime snapshot, re-read only when the file changes."""
    path = root / "realtime" / "latest.json"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if _realtime_cache["mtime"] != mtime:
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return None
        _realtime_cache.update(mtime=mtime, data=data if data.get("format") == "egi-realtime/1" else None)
    return _realtime_cache["data"]


def realtime_status(snapshot: dict | None, now_epoch: float) -> str:
    """'live' when trip updates were fetched within REALTIME_MAX_AGE_S, else 'stale' or 'none'."""
    if not snapshot:
        return "none"
    fetched = snapshot.get("feeds", {}).get("trip_updates", {}).get("fetched_epoch")
    return "live" if fetched and now_epoch - fetched <= REALTIME_MAX_AGE_S else "stale"


def trip_patterns(path: Path, trip_ids: list[str]) -> dict[str, tuple]:
    """trip_id → (route_id, direction_id, headsign) from the version's trips table."""
    if not trip_ids:
        return {}
    db = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        out = {}
        for start in range(0, len(trip_ids), 500):
            chunk = trip_ids[start:start + 500]
            sql = (
                "SELECT t.trip_id, p.route_id, p.direction_id, p.headsign FROM trips t"
                f" JOIN patterns p ON p.id = t.pattern_id WHERE t.trip_id IN ({','.join('?' * len(chunk))})"
            )
            out.update({row[0]: row[1:] for row in db.execute(sql, chunk)})
        return out
    finally:
        db.close()


def active_alerts(snapshot: dict | None, routes: set[str], stops: set[str], now_epoch: float) -> list[dict]:
    """Alerts in force now that name one of the routes or stops."""
    found = []
    for alert in (snapshot or {}).get("alerts", []):
        in_force = any(
            (p.get("start") or 0) <= now_epoch <= (p.get("end") or float("inf"))
            for p in alert.get("periods", [])
        )
        if in_force and (routes.intersection(alert["routes"]) or stops.intersection(alert["stops"])):
            found.append({k: alert[k] for k in ("id", "header", "description", "url", "routes", "stops")})
    return found


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
    now_epoch = moment.timestamp()
    snapshot = load_realtime(root or ROOT)
    status = realtime_status(snapshot, now_epoch)
    result = {
        "availability": "unavailable",
        "service_date": today.isoformat(),
        "now": clock(now_min),
        "realtime": {
            "status": status,
            "fetched_at": (snapshot or {}).get("feeds", {}).get("trip_updates", {}).get("fetched_at"),
        },
        "alerts": [],
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
            if route not in network["routes"] or not local_route(network["routes"][route]):
                continue
            key = (stop, route, direction, headsign)
            times = groups.setdefault(key, [])
            if service in active_today:
                times.extend(m for m in minutes if m >= now_min)
            if service in active_yesterday:
                times.extend(m - 1440 for m in minutes if m - 1440 >= now_min)
        predicted: dict[tuple, list] = {}
        if status == "live":
            wanted = stop_ids[:MAX_STOPS]
            rows = [(stop, row) for stop in wanted for row in snapshot["predictions"].get(stop, [])]
            patterns = trip_patterns(path, sorted({row[0] for _, row in rows}))
            for stop, (trip_id, epoch, delay) in rows:
                pattern = patterns.get(trip_id)
                if not pattern or epoch < now_epoch - 30 or (route_ids is not None and pattern[0] not in route_ids):
                    continue
                if pattern[0] not in network["routes"] or not local_route(network["routes"][pattern[0]]):
                    continue
                predicted.setdefault((stop, *pattern), []).append((epoch, delay))
                groups.setdefault((stop, *pattern), [])
    except (OSError, ValueError, KeyError, TypeError, sqlite3.Error):
        return result
    colors = stop_index(manifest["version"], network).colors
    departures = []
    for (stop, route, direction, headsign), times in groups.items():
        mode = network["routes"][route]["mode"]
        upcoming = sorted(set(times))[:limit]
        live = sorted(predicted.get((stop, route, direction, headsign), []))[:limit]
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
                "realtime": [
                    {
                        "time": datetime.fromtimestamp(epoch, ROME).strftime("%H:%M"),
                        "in_min": max(0, round((epoch - now_epoch) / 60)),
                        "delay_min": round(delay / 60) if delay is not None else None,
                    }
                    for epoch, delay in live
                ],
            }
        )
    def first(d):
        """Minutes to the next departure: predicted if any, else scheduled."""
        upcoming = (d["realtime"] or d["times"])[:1]
        return upcoming[0]["in_min"] if upcoming else 10**6

    departures.sort(key=lambda d: (first(d), d["code"], d["headsign"]))
    result.update(
        availability="available",
        departures=departures,
        alerts=active_alerts(
            snapshot, {d["route_id"] for d in departures} | (route_ids or set()), set(stop_ids), now_epoch
        ),
    )
    return result


def next_departures_all(
    stop_ids: list[str],
    route_ids: set[str] | None,
    limit: int,
    roots,
    now: datetime | None = None,
) -> dict:
    """next_departures over several runtimes; realtime status comes from the first.

    Stop and route IDs of different sources do not collide in practice (Roma
    Mobilità codes vs RFI station codes); each source simply finds only its own.
    """
    results = [next_departures(stop_ids, route_ids, limit, root, now) for root in roots]
    merged = dict(results[0])
    merged["availability"] = "available" if any(r["availability"] == "available" for r in results) else results[0]["availability"]
    merged["departures"] = [d for r in results for d in r["departures"]]
    merged["alerts"] = [a for r in results for a in r["alerts"]]
    return merged
