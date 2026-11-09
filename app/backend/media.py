"""Choose how to represent a service visually, provider by provider.

Decisions (user, 2026-11-09):
- services that must not be easy to recognise get no image at all;
- 360° images are preferred over flat ones;
- provider priority: organisation submission, then Mapillary, then user submission;
  Google Street View is offered only on request, as a link that opens Google Maps.

Inputs are local files written by other tools; nothing here downloads, stores or
proxies images, and the app holds no provider token:
- `.local/media/submissions.json`: approved organisation/user submissions (interim
  store until the `media.*` schema is approved; empty or absent is normal);
- `.local/mapillary/candidates.json`: Mapillary metadata from the phase-1 run.
The whole module is switched off with EGI_MEDIA_ENABLED=0.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

PROJECT = Path(__file__).resolve().parents[3]
SUBMISSIONS = PROJECT / ".local/media/submissions.json"
MAPILLARY = PROJECT / ".local/mapillary/candidates.json"
PROVIDER_ORDER = ["organization", "mapillary", "user"]
MAPILLARY_MAX_M = 30  # farther images rarely show the entrance (coverage run 2026-11-09)
MAPILLARY_MAX_YEARS = 6

# Conservative: a false positive only hides photos. Matched against name, type,
# layer, description and positive access/audience claims.
SENSITIVE = re.compile(
    r"\b(anti\s*-?\s*violenza|violenz\w*|maltrattament\w*|tratta|sfruttament\w*|"
    r"casa\s+rifugio|case\s+rifugio|rifugio\s+per\s+donne|casa\s+di\s+fuga|cav|"
    r"indirizzo\s+riservato|struttur\w+\s+protett\w*|vittim\w*)\b",
    re.IGNORECASE,
)
SENSITIVE_FLAGS = {"vittima_di_violenza", "vittima_di_tortura"}


def enabled() -> bool:
    """Media are on unless EGI_MEDIA_ENABLED is 0/false/no/off."""
    return os.environ.get("EGI_MEDIA_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def sensitivity(service: dict[str, Any]) -> str | None:
    """Return why a service must not be shown in images, or None."""
    place = service.get("place") or {}
    if place.get("is_protected_address"):
        return "protected_address"
    if any(service.get("access_raw", {}).get(flag) is True for flag in SENSITIVE_FLAGS):
        return "sensitive_audience"
    native = service.get("native_classifications") or {}
    text = " ".join(str(v) for v in [
        service.get("name"), service.get("service_title"), service.get("facility_name"),
        service.get("description"), native.get("tipologia"), native.get("bisogno"),
        *[p.get("nome") for p in native.get("prestazioni") or [] if isinstance(p, dict)],
    ] if v)
    return "sensitive_service" if SENSITIVE.search(text) else None


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


class MediaCatalog:
    """Read the local inputs, re-reading a file only when it changed."""

    def __init__(self, submissions: Path = SUBMISSIONS, mapillary: Path = MAPILLARY):
        self.paths = {"submissions": submissions, "mapillary": mapillary}
        self.cache: dict[str, tuple[float, Any]] = {}

    def get(self, name: str) -> Any:
        path = self.paths[name]
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return None
        if name not in self.cache or self.cache[name][0] != mtime:
            self.cache[name] = (mtime, _load(path))
        return self.cache[name][1]

    def submissions(self, service_id: str) -> list[dict[str, Any]]:
        rows = self.get("submissions") or []
        return [r for r in rows if r.get("service_id") == service_id and r.get("status") == "approved"
                and r.get("provider") in {"organization", "user"} and r.get("url")]

    def mapillary(self, service_id: str) -> list[dict[str, Any]]:
        return ((self.get("mapillary") or {}).get("pois") or {}).get(service_id, {}).get("best", [])


def mapillary_score(c: dict[str, Any]) -> float | None:
    """Rank a Mapillary candidate; None when it is unlikely to show the entrance."""
    distance, age = c.get("distance_m"), c.get("age_years")
    if distance is None or distance > MAPILLARY_MAX_M or (age is not None and age > MAPILLARY_MAX_YEARS):
        return None
    if not (c.get("pano") or c.get("facing")):
        return None
    score = 3 * (1 - distance / MAPILLARY_MAX_M) + (1 if age is not None and age < 3 else 0)
    return score + (3 if c.get("pano") else 0)  # 360° first


def _item(provider: str, **fields: Any) -> dict[str, Any]:
    return {"provider": provider, **fields}


def representation(service: dict[str, Any], catalog: MediaCatalog) -> dict[str, Any]:
    """Primary image, gallery and on-request options for one service card."""
    result: dict[str, Any] = {"service_id": service["id"], "enabled": enabled(), "excluded": None,
                              "primary": None, "gallery": [], "on_request": []}
    if not result["enabled"]:
        return result
    reason = sensitivity(service)
    placement = service.get("placement") or {}
    geometry = (service.get("place") or {}).get("geometry")
    if reason:
        result["excluded"] = reason
        return result
    if placement.get("section") == "directory" or service.get("itinerant_source"):
        result["excluded"] = "no_fixed_site"
        return result

    items: list[tuple[int, float, dict[str, Any]]] = []
    for s in catalog.submissions(service["id"]):
        rank = PROVIDER_ORDER.index(s["provider"])
        items.append((rank, (3 if s.get("is_360") else 0) + (1 if s.get("primary") else 0), _item(
            s["provider"], url=s["url"], is_360=bool(s.get("is_360")), author=s.get("author"),
            licence=s.get("licence"), caption=s.get("caption"), submitted_at=s.get("submitted_at"))))
    for c in catalog.mapillary(service["id"]):
        score = mapillary_score(c)
        if score is None:
            continue
        items.append((PROVIDER_ORDER.index("mapillary"), score, _item(
            "mapillary", image_id=c["id"], is_360=bool(c.get("pano")), author=c.get("creator"),
            licence="CC BY-SA 4.0", distance_m=c.get("distance_m"), age_years=c.get("age_years"),
            camera={"lat": c.get("lat"), "lon": c.get("lon"), "bearing": c.get("bearing")},
            embed_url=f"https://www.mapillary.com/embed?image_key={c['id']}&style=photo",
            page_url=f"https://www.mapillary.com/app/?pKey={c['id']}&focus=photo")))
    items.sort(key=lambda t: (t[0], -t[1]))
    ordered = [i for *_, i in items]
    result["primary"] = ordered[0] if ordered else None
    result["gallery"] = ordered[1:6]
    if geometry and geometry.get("type") == "Point":
        lon, lat = geometry["coordinates"]
        result["on_request"].append(_item(
            "street_view", label="Apri Street View (Google)",
            url=f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat:.6f},{lon:.6f}",
            note="Si apre su Google Maps; EGI non carica né salva immagini Google."))
    result["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return result
