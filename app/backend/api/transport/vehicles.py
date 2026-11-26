"""Read the latest vehicle snapshot by area and line without request state or writes."""
import json
import math
import time
from pathlib import Path

STALE_SECONDS = 180
MAX_BYTES = 2 * 1024 * 1024


def positions(root: Path, bounds, lines=(), now=None):
    """Filter egi-vehicles/1 in memory; stale/malformed data never freezes buses."""
    now = time.time() if now is None else now
    result = {'availability': 'unavailable', 'stale': True, 'feed_timestamp': None,
              'now': now, 'vehicles': [], 'licence': 'CC BY-SA', 'attribution': 'Roma Mobilità'}
    try:
        with (root / 'realtime/vehicles.json').open('rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return result
        snapshot = json.loads(raw)
        if snapshot['format'] != 'egi-vehicles/1' or not isinstance(snapshot['vehicles'], list):
            return result
        stamp = snapshot['feed_timestamp']
        times = (stamp, snapshot['fetched_epoch'])
        stale = any(not isinstance(t, (int, float)) or not math.isfinite(t) or not 0 <= now-t <= STALE_SECONDS for t in times)
        result.update(availability='available', stale=stale, feed_timestamp=stamp)
        if stale:
            return result
        west, south, east, north = bounds
        wanted = set(lines)
        for item in snapshot['vehicles']:
            lat, lon = item['lat'], item['lon']
            if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lat, lon)):
                continue
            if not west <= lon <= east or not south <= lat <= north or (wanted and item.get('code') not in wanted):
                continue
            timestamp = item.get('timestamp')
            age = now-timestamp if isinstance(timestamp, (int, float)) and math.isfinite(timestamp) and timestamp <= now else None
            result['vehicles'].append({k: item.get(k) for k in ('id','lat','lon','bearing','code','route_id','trip_id','direction')})
            result['vehicles'][-1].update(timestamp=timestamp, age=age)
        return result
    except (OSError, ValueError, KeyError, TypeError):
        result.update(availability='unavailable', stale=True, vehicles=[])
        return result
