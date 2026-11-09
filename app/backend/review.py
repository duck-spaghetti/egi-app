"""Duplicate review: candidate pairs and groups of services that may describe the same thing.

Read-only. Candidates are cross-source only and come from blocking on the normalized
address, a shared phone or email, and a 40 m grid around placed services (services
without a position still match by address or contact). Each pair gets a score from
independent signals, kept as evidence the reviewer can read:

| Signal | Points |
| --- | ---: |
| same street and house number (normalized) | 3 |
| same street, other or no number, within 150 m | 1 |
| within 25 m / within 60 m | 2 / 1 |
| shared phone (numbers listed by many services excluded) | 3 |
| shared email | 3 |
| shared contact a source lists for 3+ of its places (organisation's, not the site's) | 1 |
| shared website domain (generic hosts excluded) | 1 |
| same service type / same need / different needs | 2 / 1 / −2 |
| name similarity ≥ 0.5 / ≥ 0.25; shared quoted proper name | 2 / 1; 2 |

Tiers: A ≥ 8 (very likely the same service), B 6–7, C 4–5, D the rest that share an
address or are within 25 m. Pairs scoring A or B are joined into groups, so one service
described by four sources shows as one group.

The reviewer's answers stay in the browser and are pasted back to the curator, who
records them in egi-importer/curation/matches.csv. Canonical entities and governance
resolution decisions are a later, separately approved step (see the dedup plan).
"""

from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Any

STOP = set("""di del della dello dei degli delle d e ed la il lo le i gli per a al alla alle ai in da dal dalla con su sul
via viale piazza piazzale largo roma rm asl centro servizio servizi sede onlus odv aps ets odv consultorio familiare
municipio associazione assoc cooperativa coop sociale soc onlus s n c snc the of and casa presso c o
mensa mense antiviolenza volontariato""".split())
NAME_EXPANSIONS = [(r"\bcav\b", "centro antiviolenza"), (r"\bs\.\s", "san "), (r"\bss\.\s", "santi "), (r"\bsant[oa']?\b", "san")]
# Cross-source labels for one kind of service (Helpinet-aligned label first).
TYPE_FAMILIES = {
    "Salute e tutela della donna": "violence_support", "Centro antiviolenza": "violence_support",
    "Sportello sociale": "listening", "Centro di ascolto": "listening", "Sportello di prossimità": "listening",
    "Centro di accoglienza": "shelter", "Riparo": "shelter", "Accoglienza e orientamento abitativo": "shelter",
    "Corsi linguistici": "language", "Corsi e formazione": "training", "Formazione professionale": "training",
    "Distribuzione generi alimentari": "food_parcels", "Mensa sociale": "meals",
}
ABBREVIATIONS = [(r"\bv\.?\s?le\b", "viale"), (r"\bp\.?\s?(?:zz?a|za)\b", "piazza"), (r"\bp\.?\s?le\b", "piazzale"),
                 (r"\bl\.?\s?go\b", "largo"), (r"\bc\.?\s?so\b", "corso"), (r"\bl\.?\s?re\b", "lungotevere"),
                 (r"\bcirc\.?(?=\s)", "circonvallazione"), (r"\bv\.(?=\s)", "via"), (r"\bs\.(?=\s)", "san"),
                 (r"\bsant[oa]?\b", "san"), (r"\bss\.?\b", "santi")]
STREET_TYPES = r"via|viale|piazza|piazzale|largo|lungotevere|lungomare|circonvallazione|corso|vicolo|borgo|salita|strada|clivo|vicolo|galleria|parco"
STREET = re.compile(rf"\b({STREET_TYPES})\s+([a-z' .]+?)[ ,]+(\d+)", re.I)
STREET_ONLY = re.compile(rf"\b({STREET_TYPES})\s+([a-z' .]+?)(?=[,\d]|$| - )", re.I)
GENERIC_DOMAINS = {"gmail.com", "libero.it", "yahoo.it", "yahoo.com", "hotmail.it", "hotmail.com", "outlook.com", "pec.it", "tiscali.it",
                   "alice.it", "virgilio.it", "facebook.com", "google.com", "comune.roma.it", "regione.lazio.it", "salutelazio.it",
                   "instagram.com", "scuolemigranti.org", "goo.gl", "bit.ly"}
NAME_SMALL = re.compile(r"\b(?:%s)\b" % "|".join(sorted(STOP, key=len, reverse=True)))


def fold(text: str | None) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9' .,/-]", " ", text)


def _expand(text: str) -> str:
    for pattern, full in ABBREVIATIONS:
        text = re.sub(pattern, full, text)
    text = re.sub(r"\b0\d{4}\b", " ", text)  # CAP
    return re.sub(r"\s+", " ", text)


def _street_name(name: str) -> str:
    words = [w for w in re.split(r"[\s.']+", name) if w and w not in {"di", "del", "della", "dei", "degli", "delle", "d", "de", "dello"}]
    return " ".join(words)


def street_key(address: str | None) -> str | None:
    """"Via delle Sette Sale 30 – Roma", "V. delle Sette Sale, 30, 00184" -> "via sette sale 30"."""
    m = STREET.search(_expand(fold(address)))
    return f"{m.group(1)} {_street_name(m.group(2))} {m.group(3)}" if m else None


def street_only(address: str | None) -> str | None:
    text = _expand(fold(address))
    m = STREET.search(text) or STREET_ONLY.search(text)
    return f"{m.group(1)} {_street_name(m.group(2))}" if m else None


def name_words(card: dict[str, Any]) -> set[str]:
    text = fold(f"{card.get('service_title') or ''} {card.get('facility_name') or ''} {card.get('organization_raw') or ''}")
    for pattern, full in NAME_EXPANSIONS:
        text = re.sub(pattern, full, text)
    return {w for w in re.split(r"[^a-z0-9]+", text) if len(w) > 2 and w not in STOP}


def quoted_names(card: dict[str, Any]) -> set[str]:
    text = f"{card.get('service_title') or ''} {card.get('facility_name') or ''}"
    found = re.findall(r"[“\"«]([^”\"»]{3,60})[”\"»]", text)
    return {" ".join(w for w in fold(q).split() if w not in STOP) for q in found} - {""}


def phones(card: dict[str, Any]) -> set[str]:
    out = set()
    for c in card.get("contacts", []):
        if (c.get("type") or c.get("channel")) != "phone":
            continue
        for chunk in re.split(r"[;,]| - | – |/(?=\d{6,})", c.get("value") or ""):
            digits = re.sub(r"\D", "", chunk)
            if digits.startswith("0039"):
                digits = digits[4:]
            elif digits.startswith("39") and len(digits) > 10:
                digits = digits[2:]
            if len(digits) >= 8:
                out.add(digits[:10])
    return out


def emails(card: dict[str, Any]) -> set[str]:
    return {(c.get("value") or "").strip().lower().removeprefix("mailto:") for c in card.get("contacts", [])
            if (c.get("type") or c.get("channel")) == "email" and "@" in (c.get("value") or "")}


def domains(card: dict[str, Any]) -> set[str]:
    out = set()
    for c in card.get("contacts", []):
        value = (c.get("value") or "").lower()
        if (c.get("type") or c.get("channel")) == "website":
            m = re.match(r"(?:https?://)?(?:www\.)?([^/:?#]+)", value)
        elif (c.get("type") or c.get("channel")) == "email" and "@" in value:
            m = re.match(r".*@([^\s>]+)", value)
        else:
            continue
        if m and m.group(1) not in GENERIC_DOMAINS and "." in m.group(1):
            out.add(m.group(1))
    return out


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.pi / 180
    x = (b[1] - a[1]) * k * math.cos((a[0] + b[0]) * k / 2)
    return 6371000 * math.hypot(x, (b[0] - a[0]) * k)


def summary(card: dict[str, Any], point: tuple[float, float] | None) -> dict[str, Any]:
    source = (card.get("sources") or [{}])[0]
    hours = card.get("hours_display") or {}
    days = [f"{d['label'][:3]} {', '.join(i['label'] for i in d['intervals'])}" for d in hours.get("days", []) if d.get("intervals")]
    return {
        "id": card["id"], "source": source.get("source_name"), "source_code": card.get("source_code", "helpinet"),
        "title": card.get("service_title"), "facility": card.get("facility_name"),
        "type": (card.get("native_classifications") or {}).get("tipologia"), "need": (card.get("category") or {}).get("label"),
        "address": (card.get("place") or {}).get("address"),
        "lat": point[0] if point else None, "lon": point[1] if point else None,
        "position": (card.get("placement") or {}).get("label"),
        "contacts": [c["value"] for c in card.get("contacts", [])][:6],
        "hours": days or ([hours.get("raw_text")] if hours.get("raw_text") else []),
        "description": (card.get("description") or "")[:300],
        "locator": card.get("source_locator"),
    }


class _Prepared:
    __slots__ = ("card", "source", "point", "key", "street", "words", "quoted", "phones", "emails", "domains", "type", "need")

    def __init__(self, card: dict[str, Any]) -> None:
        self.card = card
        self.source = card.get("source_code", "helpinet")
        geometry = (card.get("place") or {}).get("geometry")
        self.point = (geometry["coordinates"][1], geometry["coordinates"][0]) if geometry else None
        address = (card.get("place") or {}).get("address")
        self.key, self.street = street_key(address), street_only(address)
        self.words, self.quoted = name_words(card), quoted_names(card)
        self.phones, self.emails, self.domains = phones(card), emails(card), domains(card)
        self.type = (card.get("native_classifications") or {}).get("tipologia")
        self.need = (card.get("category") or {}).get("code")


def score_pair(a: _Prepared, b: _Prepared, generic_phones: set[str], org_contacts: set[str] = frozenset()) -> tuple[int, list[str], dict[str, Any]]:
    points, why = 0, []
    distance = metres(a.point, b.point) if a.point and b.point else None
    same_address = bool(a.key and a.key == b.key)
    if same_address:
        points += 3
        why.append("stesso indirizzo e civico")
    elif a.street and a.street == b.street and (distance is None or distance <= 150):
        points += 1
        why.append("stessa via")
    if distance is not None:
        if distance <= 25:
            points += 2
            why.append(f"{round(distance)} m")
        elif distance <= 60:
            points += 1
            why.append(f"{round(distance)} m")
    shared_phones = (a.phones & b.phones) - generic_phones
    shared_emails = a.emails & b.emails
    site_contacts = (shared_phones | shared_emails) - org_contacts
    if shared_phones & site_contacts:
        points += 3
        why.append("stesso telefono")
    if shared_emails & site_contacts:
        points += 3
        why.append("stessa email")
    if (shared_phones | shared_emails) and not site_contacts:
        points += 1
        why.append("stesso contatto dell'organizzazione")
    elif not shared_emails and a.domains & b.domains:
        points += 1
        why.append("stesso dominio web")
    same_type = bool(a.type and a.type == b.type)
    equivalent = bool(not same_type and a.type and TYPE_FAMILIES.get(a.type) and TYPE_FAMILIES.get(a.type) == TYPE_FAMILIES.get(b.type))
    if same_type or equivalent:
        points += 2
        why.append("stesso tipo di servizio" if same_type else f"tipo equivalente ({a.type} / {b.type})")
        same_type = True
    elif a.need and a.need == b.need:
        points += 1
        why.append("stesso bisogno")
    elif a.need and b.need:
        points -= 2
        why.append("bisogni diversi")
    elif a.type and b.type:
        points -= 1
        why.append("tipi diversi")
    union = a.words | b.words
    similarity = len(a.words & b.words) / len(union) if union else 0.0
    if similarity >= 0.5:
        points += 2
    elif similarity >= 0.25:
        points += 1
    if similarity >= 0.25:
        why.append(f"nomi simili ({similarity:.2f})")
    if a.quoted & b.quoted:
        points += 2
        why.append("stesso nome proprio")
    return points, why, {"distance_m": None if distance is None else round(distance), "same_address": same_address, "same_type": same_type,
                         "shared_words": sorted(a.words & b.words), "name_similarity": round(similarity, 2),
                         "shared_contacts": sorted(shared_phones | shared_emails)}


def tier_for(points: int, facts: dict[str, Any]) -> str | None:
    if points >= 8:
        return "A"
    if points >= 6:
        return "B"
    if points >= 4:
        return "C"
    if facts["same_address"] or (facts["distance_m"] is not None and facts["distance_m"] <= 25):
        return "D"
    return None


def overlap_pairs(cards: list[dict[str, Any]], max_distance: float = 40.0) -> list[dict[str, Any]]:
    """Cross-source candidate pairs with score, evidence and group, strongest first."""
    prepared = [_Prepared(c) for c in cards]
    phone_use = Counter(p for item in prepared for p in item.phones)
    generic_phones = {p for p, n in phone_use.items() if n > 6}  # switchboards, CUP, helplines listed by many services
    # A phone or email that one source lists for several of its places belongs to the
    # organisation (a CPIA switchboard), not to one site: it supports a match only weakly.
    per_source = Counter((item.source, c) for item in prepared for c in (item.phones | item.emails))
    org_contacts = {c for (_, c), n in per_source.items() if n > 2}
    blocks: dict[tuple[str, str], list[int]] = defaultdict(list)
    cell = max_distance / 111000
    for i, item in enumerate(prepared):
        if item.key:
            blocks[("addr", item.key)].append(i)
        for p in item.phones - generic_phones:
            blocks[("phone", p)].append(i)
        for e in item.emails:
            blocks[("email", e)].append(i)
        if item.point:
            blocks[("grid", f"{int(item.point[0] // cell)}:{int(item.point[1] // (cell * 1.35))}")].append(i)
    grid = {k[1]: v for k, v in blocks.items() if k[0] == "grid"}
    seen: set[tuple[int, int]] = set()
    candidates: set[tuple[int, int]] = set()
    for (kind, value), members in blocks.items():
        group = list(members)
        if kind == "grid":  # neighbours in adjacent cells too
            gy, gx = (int(x) for x in value.split(":"))
            group = [m for dy in (-1, 0, 1) for dx in (-1, 0, 1) for m in grid.get(f"{gy + dy}:{gx + dx}", [])]
        for x in members:
            for y in group:
                if x != y and prepared[x].source != prepared[y].source:
                    candidates.add((min(x, y), max(x, y)))
    pairs = []
    for x, y in candidates:
        if (x, y) in seen:
            continue
        seen.add((x, y))
        a, b = prepared[x], prepared[y]
        points, why, facts = score_pair(a, b, generic_phones, org_contacts)
        tier = tier_for(points, facts)
        if tier is None:
            continue
        if a.card["id"] > b.card["id"]:
            a, b = b, a
        ids = [a.card["id"], b.card["id"]]
        pairs.append({
            "pair_id": hashlib.sha1("|".join(ids).encode()).hexdigest()[:8],
            "tier": tier, "score": points, "evidence": why, **facts,
            "a": summary(a.card, a.point), "b": summary(b.card, b.point),
        })
    _assign_groups(pairs)
    pairs.sort(key=lambda p: (p["tier"], -p["score"], p["distance_m"] if p["distance_m"] is not None else 9999, p["a"]["title"] or ""))
    for n, pair in enumerate(pairs, 1):
        pair["number"] = n
    return pairs


def _assign_groups(pairs: list[dict[str, Any]]) -> None:
    """Union A/B pairs of the same (or equivalent) service type into groups: one service
    seen by several sources. Different services at one address (a canteen and a hostel
    sharing a switchboard) stay separate pairs instead of chaining into one group."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    joins = [p for p in pairs if p["tier"] in {"A", "B"} and p["same_type"]]
    for p in joins:
        parent[find(p["a"]["id"])] = find(p["b"]["id"])
    members: dict[str, set[str]] = defaultdict(set)
    sources: dict[str, set[str]] = defaultdict(set)
    for p in joins:
        root = find(p["a"]["id"])
        members[root] |= {p["a"]["id"], p["b"]["id"]}
        sources[root] |= {p["a"]["source_code"], p["b"]["source_code"]}
    names = {root: hashlib.sha1("|".join(sorted(m)).encode()).hexdigest()[:6] for root, m in members.items()}
    for p in pairs:
        root = find(p["a"]["id"]) if p["a"]["id"] in parent and find(p["a"]["id"]) == find(p["b"]["id"]) else None
        p["group"] = ({"id": names[root], "size": len(members[root]), "sources": sorted(sources[root])} if root in members else None)
