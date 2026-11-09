"""Overlap review: candidate pairs of services that may describe the same thing.

Read-only. Pairs come from the services the map shows (placed cards), across
different sources, and are graded:

- A: same street and house number, and same service type;
- B: within 40 m, and same service type;
- C: same street and number, or within 25 m, with shared name words;
- D: within 25 m only (same building or neighbours).

The reviewer's answers (same service / same place, different services / different)
are kept in the browser and pasted back to the curator, who records them in
egi-importer/curation/matches.csv. Canonical entities and governance resolution
decisions are a later, separately approved step (see the dedup plan).
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from typing import Any

STOP = set("di del della dei degli delle e la il lo le i per a in da con via viale piazza largo roma rm asl centro "
           "servizio sede onlus odv aps consultorio familiare municipio".split())
STREET = re.compile(r"\b(via|viale|piazza|piazzale|largo|lungotevere|circonvallazione|corso|vicolo|borgo|salita|strada)\s+([a-z' .]+?)[ ,]+(\d+)")


def fold(text: str | None) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9' ]", " ", text)


def street_key(address: str | None) -> str | None:
    m = STREET.search(fold(address))
    return f"{m.group(1)} {' '.join(m.group(2).split())} {m.group(3)}" if m else None


def name_words(card: dict[str, Any]) -> set[str]:
    text = f"{card.get('service_title') or ''} {card.get('facility_name') or ''} {card.get('organization_raw') or ''}"
    return {w for w in fold(text).split() if len(w) > 2 and w not in STOP}


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.pi / 180
    x = (b[1] - a[1]) * k * math.cos((a[0] + b[0]) * k / 2)
    return 6371000 * math.hypot(x, (b[0] - a[0]) * k)


def summary(card: dict[str, Any], point: tuple[float, float]) -> dict[str, Any]:
    source = (card.get("sources") or [{}])[0]
    hours = card.get("hours_display") or {}
    days = [f"{d['label'][:3]} {', '.join(i['label'] for i in d['intervals'])}" for d in hours.get("days", []) if d.get("intervals")]
    return {
        "id": card["id"], "source": source.get("source_name"), "source_code": card.get("source_code", "helpinet"),
        "title": card.get("service_title"), "facility": card.get("facility_name"),
        "type": (card.get("native_classifications") or {}).get("tipologia"), "need": (card.get("category") or {}).get("label"),
        "address": (card.get("place") or {}).get("address"), "lat": point[0], "lon": point[1],
        "position": (card.get("placement") or {}).get("label"),
        "contacts": [c["value"] for c in card.get("contacts", [])][:6],
        "hours": days or ([hours.get("raw_text")] if hours.get("raw_text") else []),
        "description": (card.get("description") or "")[:300],
        "locator": card.get("source_locator"),
    }


def overlap_pairs(cards: list[dict[str, Any]], max_distance: float = 40.0) -> list[dict[str, Any]]:
    """Cross-source candidate pairs among placed cards, strongest tier first."""
    rows = []
    for card in cards:
        geometry = (card.get("place") or {}).get("geometry")
        if not geometry:
            continue
        lon, lat = geometry["coordinates"]
        rows.append((card, (lat, lon), street_key((card.get("place") or {}).get("address")), name_words(card),
                     (card.get("native_classifications") or {}).get("tipologia")))
    rows.sort(key=lambda r: r[1][0])
    pairs = []
    window = max_distance / 111000
    for i, (a, pa, ka, wa, ta) in enumerate(rows):
        for b, pb, kb, wb, tb in rows[i + 1:]:
            if pb[0] - pa[0] > window:
                break
            if a.get("source_code", "helpinet") == b.get("source_code", "helpinet"):
                continue
            d = metres(pa, pb)
            same_address = bool(ka and ka == kb)
            if d > max_distance and not same_address:
                continue
            same_type = bool(ta and ta == tb)
            shared = sorted(wa & wb)
            if same_address and same_type:
                tier = "A"
            elif d <= 40 and same_type:
                tier = "B"
            elif (same_address or d <= 25) and shared:
                tier = "C"
            elif d <= 25:
                tier = "D"
            else:
                continue
            ids = sorted([a["id"], b["id"]])
            pairs.append({
                "pair_id": hashlib.sha1("|".join(ids).encode()).hexdigest()[:8],
                "tier": tier, "distance_m": round(d), "same_address": same_address, "same_type": same_type,
                "shared_words": shared,
                "a": summary(a, pa), "b": summary(b, pb),
            })
    pairs.sort(key=lambda p: (p["tier"], p["distance_m"], p["a"]["title"] or ""))
    for n, pair in enumerate(pairs, 1):
        pair["number"] = n
    return pairs
