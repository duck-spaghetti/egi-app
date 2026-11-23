"""Need-first presentation taxonomy (vocabulary `taxonomy_v0_3.json`), applied to service cards.

Read-only interpretation: original source fields stay untouched; every assignment carries
its basis so that interpretations can be reviewed and corrected later (user decision,
2026-11-09: interpretations are acceptable while the original data is kept).

For one card `apply` sets:

- `offers`: what the service gives (Pasto, Docce, STP/ENI …), each with need, label and basis —
  the source service type ("tipo della fonte"), a name rule ("nome"), or a printed word
  ("testo: «docce»", marked `interpreted`);
- `needs` (all needs, primary first) and `category` (the primary need tile); the primary need
  comes from the source service type, else the source's own need, else the first offer;
- `audiences` ("per chi"; `reserved` when the text says solo/riservato), `access_tags`,
  `meal_times` (colazione/pranzo/cena from hours, else from words) for services offering a meal;
- membership of "Centri diurni e multiservizi" by type/name or by at least two basic needs
  (eat, wash, sleep) at one place.

Structured sources (`structured.sources`, Helpinet) follow the v0.3 rule instead (user,
2026-11-15): a card enters one need, from its own service type or a listed override, and its
offers come only from its own type and `prestazioni` inside that need — never from the facility
name nor from referral offers ("Orientamento ai servizi"). See `structured_offers`.

The vocabulary is the approved v0.3 proposal (.scratch/taxonomy/proposal.md §13), not the
canonical taxonomy; offers can be switched off with `"enabled": false`.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

VOCABULARY = Path(__file__).with_name("taxonomy_v0_3.json")
TIME_RANGE = re.compile(r"(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})")


def fold(text: str | None) -> str:
    """Lower-case ASCII text for matching (accents removed)."""
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


def _compile(pattern: str | None) -> re.Pattern[str] | None:
    return re.compile(rf"(?:{fold(pattern)})", re.I) if pattern else None


@lru_cache(maxsize=1)
def vocabulary() -> dict[str, Any]:
    """The vocabulary file with compiled rules (read once)."""
    return compile_vocabulary(json.loads(VOCABULARY.read_text(encoding="utf-8")))


def compile_vocabulary(data: dict[str, Any]) -> dict[str, Any]:
    """Compile the rules of a vocabulary dict (also used by tests for variants)."""
    for group in ("offers", "audiences", "access"):
        for item in data[group]:
            item["_words"], item["_names"] = _compile(item.get("words")), _compile(item.get("names"))
            item["_types"] = set(item.get("types", []))
    for slot in data["meal_times"]["slots"]:
        slot["_words"] = _compile(slot.get("words"))
    data["_not_offers"] = _compile(data.get("not_offer_phrases"))
    data["_reserved"] = _compile(data.get("reserved_words"))
    data["_needs"] = {n["code"]: n for n in data["needs"]}
    data["_offers"] = {o["code"]: o for o in data["offers"]}
    for rule in (data.get("structured") or {}).get("need_overrides", []):
        rule["_names"] = _compile(rule.get("names"))
    return data


def need_categories() -> list[dict[str, Any]]:
    """Need tiles in the shape the map expects for categories."""
    return [
        {"id": i, "slug": n["code"], "label": n["label"], "color": n["color"],
         "icon_path": f"/static/assets/icons/default/{n['icon']}.svg", "sort_order": i, "area_id": 1,
         "is_active": True, "classification_status": vocabulary()["version"]}
        for i, n in enumerate(vocabulary()["needs"], 1)
    ]


def card_text(card: dict[str, Any]) -> str:
    """Folded title, facility, description, offer text and source topics of a card."""
    natives = card.get("native_classifications") or {}
    parts = [card.get("service_title"), card.get("facility_name"), card.get("description"), card.get("offer_text")]
    parts += [p.get("nome", "") for p in natives.get("prestazioni") or [] if isinstance(p, dict)]
    text = fold(" ".join(str(p or "") for p in parts))
    not_offers = vocabulary()["_not_offers"]
    return not_offers.sub(" ", text) if not_offers else text


def _match(item: dict[str, Any], kind: str | None, title: str, text: str) -> tuple[str, bool] | None:
    """(basis, interpreted) when a rule matches the card, else None."""
    if kind and kind in item["_types"]:
        return f"tipo della fonte: {kind}", False
    if item["_names"] and (m := item["_names"].search(title)):
        return f"nome: «{m.group(0)}»", False
    if item["_words"] and (m := item["_words"].search(text)):
        return f"testo: «{m.group(0)}»", True
    return None


def _minutes(hour: str, minute: str) -> int:
    return int(hour) * 60 + int(minute)


def time_windows(card: dict[str, Any]) -> list[tuple[int, int]]:
    """Opening windows in minutes from structured hours, printed blocks or raw hour text."""
    display = card.get("hours_display") or {}
    windows = []
    for day in display.get("days", []):
        for interval in day.get("intervals", []):
            if m := TIME_RANGE.search(interval.get("label", "")):
                windows.append((_minutes(m[1], m[2]), _minutes(m[3], m[4])))
    texts = [b.get("text", "") for b in display.get("scoped") or []] or [display.get("raw_text") or card.get("hours_raw") or ""]
    for text in texts:
        if not isinstance(text, str):  # Helpinet keeps structured hours, already read above
            continue
        for m in TIME_RANGE.finditer(text):
            windows.append((_minutes(m[1], m[2]), _minutes(m[3], m[4])))
    return [(s, e) for s, e in windows if s < e]


def meal_times(card: dict[str, Any], text: str) -> list[dict[str, str]]:
    """Colazione/pranzo/cena: from opening windows when present, else from printed words."""
    def at(value: str) -> int:
        h, m = value.split(":")
        return int(h) * 60 + int(m)
    found: dict[str, dict[str, str]] = {}
    windows = time_windows(card)
    for slot in vocabulary()["meal_times"]["slots"]:
        hit = None
        for s, e in windows:
            if ("starts_before" in slot and s < at(slot["starts_before"])) or \
               ("overlaps" in slot and s < at(slot["overlaps"][1]) and e > at(slot["overlaps"][0])) or \
               ("ends_after" in slot and e > at(slot["ends_after"])):
                hit = f"orari: {s // 60:02d}:{s % 60:02d}–{e // 60:02d}:{e % 60:02d}"
                break
        if not hit and slot["_words"] and (m := slot["_words"].search(text)):
            hit = f"testo: «{m.group(0)}»"
        if hit:
            found[slot["code"]] = {"code": slot["code"], "label": slot["label"], "basis": hit, "interpreted": True}  # deduced
    return list(found.values())


def _offer(code: str, basis: str, interpreted: bool = False) -> dict[str, Any]:
    """One offer entry of the vocabulary with its basis."""
    item = vocabulary()["_offers"][code]
    return {"code": code, "need": item["need"], "label": item["label"], "basis": basis, "interpreted": interpreted}


def structured_offers(card: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]] | None:
    """Needs and offers of a structured-source card (type + own prestazioni), else None.

    The need comes from an override (a listed prestazione, or the service's own name such as
    "CAV …"), else the source type, else the source's own need. Offers are the clusters of the
    card's own prestazioni that belong to that need; the type's default cluster is added when no
    prestazione gives one (always, for types listed in `type_offer_always`). Itinerant
    orientation desks become street presences.
    """
    vocab = vocabulary()
    rules = vocab.get("structured") or {}
    if card.get("source_code") not in rules.get("sources", []):
        return None
    natives = card.get("native_classifications") or {}
    kind = natives.get("tipologia")
    names = [p.get("nome") for p in natives.get("prestazioni") or [] if isinstance(p, dict) and p.get("nome")]
    title = fold(card.get("name") or card.get("facility_name") or "")
    need, forced = None, None
    for rule in rules.get("need_overrides", []):
        if set(rule.get("prestazioni", [])) & set(names) or (rule.get("_names") and rule["_names"].search(title)):
            need, forced = rule["need"], (rule.get("offer"), rule["basis"])
            break
    source_need = (card.get("category") or {}).get("slug")
    need = need or rules["type_need"].get(kind or "") or vocab["source_need_fallback"].get(source_need or "")
    if not need:
        return None
    offers: list[dict[str, Any]] = []
    if forced and forced[0]:
        offers.append(_offer(forced[0], forced[1]))
    derived = card.get("derived_prestazioni") or {}  # name -> basis, e.g. Italian courses of a CPIA (r2)
    for name in names:
        code = rules["prestazioni"].get(name)
        if code and vocab["_offers"][code]["need"] == need and code not in {o["code"] for o in offers}:
            offers.append(_offer(code, derived[name], True) if name in derived else _offer(code, f"prestazione della fonte: {name}"))
    for code, dropped in rules.get("excludes", {}).items():
        if code in {o["code"] for o in offers}:
            offers = [o for o in offers if o["code"] not in dropped]
    default = rules["type_offer"].get(kind or "")
    if card.get("itinerant_source") and need in rules.get("itinerant_offer", {}):
        default = rules["itinerant_offer"][need]
        offers = [o for o in offers if o["code"] != rules["type_offer"].get(kind or "")]
        offers.insert(0, _offer(default, "servizio itinerante della fonte"))
    elif default and vocab["_offers"][default]["need"] == need and default not in {o["code"] for o in offers} \
            and (not offers or kind in rules.get("type_offer_always", [])):
        offers.insert(0, _offer(default, f"tipo della fonte: {kind}"))
    return [need], offers


def apply(card: dict[str, Any]) -> dict[str, Any]:
    """Add offers, needs, primary category, audiences, access tags and meal times to a card."""
    vocab = vocabulary()
    kind = (card.get("native_classifications") or {}).get("tipologia")
    title = fold(f"{card.get('service_title') or ''} {card.get('name') or ''}")
    text = card_text(card)
    source_need = (card.get("category") or {}).get("slug")
    structured = structured_offers(card)
    offers = []
    overriding = False
    for item in vocab["offers"] if structured is None else []:
        if item.get("enabled", True) is False:
            continue
        if hit := _match(item, kind, title, text):
            offers.append({"code": item["code"], "need": item["need"], "label": item["label"], "basis": hit[0], "interpreted": hit[1]})
            overriding |= bool(item.get("overrides_type")) and hit[0].startswith("nome")
    if overriding:  # e.g. Agenzia delle Entrate typed "Sportello sociale pubblico" by the guide: the name decides
        offers = [o for o in offers if not o["basis"].startswith("tipo della fonte")]
        source_need = None
    needs: list[str] = []
    by_type = [o["need"] for o in offers if o["basis"].startswith("tipo della fonte")]
    if any(vocab["_offers"][o["code"]].get("replaces_source_need") for o in offers if o["basis"].startswith("tipo della fonte")):
        source_need = None  # e.g. an anti-violence centre listed under "ascolto" belongs to Violenza only (v0.3)
    fallback = vocab["source_need_fallback"].get(source_need or "")
    # Source needs of a same-source group (a placemark repeated per layer) are kept too.
    grouped = [] if overriding or source_need is None else [vocab["source_need_fallback"].get(n, n if n in vocab["_needs"] else None) for n in card.get("needs") or []]
    for need in by_type + ([fallback] if fallback else []) + grouped + [o["need"] for o in offers]:
        if need and need not in needs:
            needs.append(need)
    if structured is not None:
        needs, offers = structured
    basic = {o["need"] for o in offers} & set(vocab["multiservice"]["basic_needs"])
    placed = bool((card.get("place") or {}).get("address") or (card.get("place") or {}).get("geometry"))
    if "multiservizi" not in needs and len(basic) >= vocab["multiservice"]["min_basic_needs"] and placed:
        needs.append("multiservizi")
        offers.append({"code": "piu_servizi", "need": "multiservizi", "label": "Più servizi di base nello stesso luogo",
                       "basis": "regola: " + ", ".join(sorted(basic)), "interpreted": True})
    if not needs:
        default = vocab["default_offer"]
        needs = [default["need"]]
        offers.append(_offer(default["code"], "nessuna regola: assegnato per difetto", True))
    primary = vocab["_needs"][needs[0]]
    category = next(c for c in need_categories() if c["slug"] == primary["code"])
    reserved = bool(vocab["_reserved"] and vocab["_reserved"].search(text))
    raw_flags = card.get("access_raw") if isinstance(card.get("access_raw"), dict) else {}
    claims = {code for code, value in raw_flags.items() if value is True}  # Helpinet lists false flags too
    claims |= {e["code"] for s in (card.get("access_display") or {}).get("sections", []) for e in s.get("entries", []) if e.get("value") is True}
    # Sources whose "per chi" and access facets were decided from stated facts only (Scuolemigranti:
    # solo donne, online, CPIA free; user 2026-11-16) get no labels from words of the page text.
    stated_only = card.get("source_code") in (vocab.get("structured") or {}).get("facets_from_claims_only", [])
    def from_text(item: dict[str, Any]) -> tuple[str, bool] | None:
        return None if stated_only else _match(item, kind, title, text)
    audiences = []
    for item in vocab["audiences"]:
        hit = ("indicazione della fonte", False) if claims & set(item.get("claims", [])) else from_text(item)
        if hit:
            audiences.append({"code": item["code"], "label": item["label"], "basis": hit[0], "interpreted": hit[1], "reserved_hint": reserved})
    access = []
    for item in vocab["access"]:
        hit = None
        if claims & set(item.get("claims", [])):
            hit = ("indicazione della fonte", False)
        elif item.get("placement") and (card.get("placement") or {}).get("section") == item["placement"]:
            hit = ("servizio a distanza", False)
        elif card.get("delivery_mode") in item.get("delivery", []):
            hit = ("modalità indicata dalla fonte", False)
        else:
            hit = from_text(item)
        if hit:
            access.append({"code": item["code"], "label": item["label"], "basis": hit[0], "interpreted": hit[1]})
    card.update({
        "source_category": card.get("category"), "category": category, "category_id": category["id"],
        "needs": needs, "offers": offers, "audiences": audiences, "access_tags": access,
        "meal_times": meal_times(card, text) if any(o["code"] in vocab["meal_times"]["offers"] for o in offers) else [],
        "taxonomy_version": vocab["version"],
    })
    return card


def public_vocabulary() -> dict[str, Any]:
    """Labels, paths, meal slots and course levels for the interface (no compiled rules)."""
    vocab = vocabulary()
    return {
        "version": vocab["version"], "needs": need_categories(),
        "offers": [{"code": o["code"], "need": o["need"], "label": o["label"]} for o in vocab["offers"] if o.get("enabled", True) is not False],
        "audiences": [{"code": a["code"], "label": a["label"]} for a in vocab["audiences"]],
        "access": [{"code": a["code"], "label": a["label"]} for a in vocab["access"]],
        "meal_times": [{"code": m["code"], "label": m["label"]} for m in vocab["meal_times"]["slots"]],
        "paths": vocab["paths"],
        "course_levels": vocab.get("course_levels", []),
    }
