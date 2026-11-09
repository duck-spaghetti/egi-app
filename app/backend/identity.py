"""Proposed identity decisions and multi-need hints for the duplicate review (read-only).

Nothing here merges or reclassifies data: it proposes, with reasons, what a reviewer
then accepts or changes on `/revisione/doppioni`. Accepted answers are recorded by the
curator in egi-importer/curation/matches.csv.

- `service_kind`: broad family of a source service type ("Centro antiviolenza" and
  "Salute e tutela della donna" are one family; a canteen and a shower are not).
- `proposed_needs`: the needs a card serves — its own need, needs implied by its kind
  (an anti-violence centre is both listening/support and health) and needs read from
  its printed offer ("doccia", "lavanderia", "vestiti", "colazione"), each with the word
  that supports it.
- `completeness`: how much a card says (description, contacts, hours, address, position
  precision, access text), to pick the primary record of one service.
- `propose`: the reviewer's question for one pair, answered by these rules:

  1. Same structure (same street and number, ≤ 15 m apart when both positions are at a
     house number or named place — street-level estimates share one point per street and
     prove nothing —, or the same site phone/e-mail) and the same kind of service →
     **same service**; the more complete card is the primary and the other adds the
     fields it lacks.
  2. Same structure, different kinds → **same place, different services** (one structure
     with several services); noted when one card's offer mentions the other's service.
     Same kind but entirely different specific names (CPIA 1 / Asinitas at one address)
     → also **same place**, medium confidence: possibly two providers at one site.
  3. Same street (or ≤ 60 m between precise positions), same kind and similar names (or
     the same proper name) → **same service**, medium confidence.
  4. Only an organisation-wide contact in common, other addresses → **different**
     (another site of one organisation).
  5. Same kind and very similar names but no common address → **unsure** (check the
     address); otherwise → **different**.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

KINDS: dict[str, str] = {
    "Medicina generale": "primary_care", "Poliambulatorio": "primary_care", "Sportello Sanitario": "primary_care",
    "Servizi sanitari e sociosanitari": "health_site", "Sportello socio sanitario": "primary_care",
    "Medicina specialistica": "primary_care", "Medicina diagnostica": "primary_care", "Assistenza infermieristica": "primary_care",
    "Screening": "primary_care", "Farmacia sociale": "pharmacy", "Rilascio STP/ENI": "stp_eni", "Pediatria": "paediatrics",
    "Consultorio familiare": "family_clinic", "Salute mentale": "mental_health", "Dipendenze (Ser.D)": "addiction",
    "Alcologia e auto-aiuto": "addiction", "Ospedale": "hospital", "Hospice": "hospice", "Malattie infettive": "infectious",
    "Centro antiviolenza": "violence_support", "Salute e tutela della donna": "violence_support",
    "Sportello sociale": "listening", "Centro di ascolto": "listening", "Sportello di prossimità": "listening",
    "Sportello sociale pubblico": "public_social", "Punto unico di accesso": "public_social", "Assistenza domiciliare": "home_care",
    "Centro di accoglienza": "shelter", "Riparo": "shelter", "Accoglienza e orientamento abitativo": "shelter",
    "Centro di accoglienza LGBTQI": "shelter", "Ostello": "shelter",
    "Mensa sociale": "meals", "Distribuzione generi alimentari": "food_parcels",
    "Igiene personale": "hygiene", "Lavanderia": "hygiene", "Abbigliamento": "clothing", "Kit": "clothing",
    "Corsi linguistici": "language", "Scuola": "language", "Corsi e formazione": "training", "Formazione professionale": "training",
    "Orientamento al lavoro": "employment", "Lavoro": "employment", "Centro di Orientamento al Lavoro": "employment_col",
    "Centro per l'Impiego": "employment_cpi", "Patronato e assistenza sindacale": "employment_union",
    "Consulenza e tutela legale": "legal_admin", "Pratiche amministrative": "legal_admin",
    "Permessi di soggiorno e immigrazione": "legal_admin", "Tribunale": "court", "Prevenzione usura": "legal_admin",
    "Unità di strada": "street_unit", "Linea telefonica di aiuto": "helpline",
    "Socialità e volontariato": "social", "Centro diurno": "day_centre",
}
# Needs a kind serves by definition, beyond the card's own need (the user's example: an
# anti-violence centre belongs to support/listening and to health).
KIND_NEEDS: dict[str, tuple[str, ...]] = {
    "violence_support": ("ascolto", "curarmi"), "mental_health": ("curarmi", "ascolto"), "addiction": ("curarmi", "ascolto"),
    "family_clinic": ("curarmi",), "stp_eni": ("curarmi", "documenti"), "hygiene": ("igiene_personale",),
    "clothing": ("abiti_e_coperte",), "meals": ("cibo",), "food_parcels": ("cibo",), "shelter": ("dormire",),
    "employment": ("lavoro",), "employment_col": ("lavoro",), "employment_cpi": ("lavoro",), "employment_union": ("lavoro", "documenti"),
    "language": ("istruzione",), "training": ("istruzione", "lavoro"), "legal_admin": ("documenti",),
    "listening": ("ascolto",), "public_social": ("ascolto", "documenti"), "street_unit": ("ascolto",), "helpline": ("ascolto",),
    "day_centre": ("socialita", "ascolto"), "primary_care": ("curarmi",), "health_site": ("curarmi",), "hospital": ("curarmi",), "hospice": ("curarmi",),
    "infectious": ("curarmi",), "paediatrics": ("curarmi",), "pharmacy": ("curarmi",), "home_care": ("curarmi", "ascolto"),
}
# Offer words printed in a description; each reads one need. Word boundaries keep
# "docce" from matching inside unrelated words.
OFFER_WORDS: list[tuple[str, str]] = [
    ("igiene_personale", r"docc[ie]a?|docce|lavanderia|barbiere|parrucchiere|igiene personale"),
    ("abiti_e_coperte", r"vestiti|vestiario|abbigliamento|guardaroba|biancheria|coperte|scarpe|indumenti|cambio abiti"),
    ("cibo", r"colazione|mensa|pasti|pasto|pranzo|cena|pacchi alimentari|pacchi viveri|viveri|alimentari|generi alimentari|buoni pasto|emporio"),
    ("curarmi", r"ambulatorio|visite mediche|medico|farmaci|farmacia|infermier\w*|psicolog\w*|dentist\w*|odontoiatri\w*|cure"),
    ("documenti", r"sportello legale|consulenza legale|aiuto legale|assistenza legale|permess[oi] di soggiorno|residenz[ae]|caaf|caf|patronato|pratiche"),
    ("istruzione", r"corsi? di (?:lingua )?italiano|scuola di (?:lingua )?italiano|doposcuola|alfabetizzazione|corsi? di lingua"),
    ("lavoro", r"ricerca (?:di )?lavoro|orientamento al lavoro|curriculum|tirocini|offerta lavoro|inserimento lavorativo"),
    ("dormire", r"dormitorio|accoglienza notturna|posti letto|ospitalit[aà] notturna"),
    ("ascolto", r"centro d[i’' ]+ascolto|segretariato sociale|sportello sociale|ascolto"),
    ("socialita", r"laboratori\w*|attivit[aà] ricreative|socialit[aà]"),
]
OFFER_RES = [(need, re.compile(rf"\b(?:{pattern})\b", re.I)) for need, pattern in OFFER_WORDS]
# Phrases where an offer word means something else ("disturbi del comportamento alimentare").
NOT_OFFERS = re.compile(r"(?:disturbi|comportament\w*)[\w\s]{0,30}alimentar\w*|nutrizion\w*", re.I)


def fold(text: str | None) -> str:
    """Lower-case ASCII text for word matching."""
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()


# A generic kind is compatible with its specific kinds ("Lavoro" with a COL or a CPI),
# but two specific kinds are not (a COL and a CPI sharing a building are two services).
GENERIC_KINDS = {"employment": {"employment_col", "employment_cpi", "employment_union"},
                 "health_site": {"primary_care", "stp_eni", "paediatrics", "family_clinic", "mental_health", "addiction", "infectious"}}


def compatible_kinds(a: str | None, b: str | None) -> bool:
    """Same kind, or one is the generic family of the other."""
    return bool(a and b) and (a == b or b in GENERIC_KINDS.get(a, ()) or a in GENERIC_KINDS.get(b, ()))


def service_kind(card: dict[str, Any]) -> str | None:
    """Broad family of the card's service type, or the type itself when unmapped."""
    kind = (card.get("native_classifications") or {}).get("tipologia")
    return KINDS.get(kind or "", kind)


def proposed_needs(card: dict[str, Any]) -> list[dict[str, str]]:
    """Needs served by the card: own need, needs of its kind, needs read from its offer."""
    found: dict[str, str] = {}
    own = (card.get("category") or {}).get("slug") or (card.get("category") or {}).get("code")
    if own:
        found[own] = "bisogno indicato dalla fonte"
    for need in card.get("needs") or []:
        found.setdefault(need, "bisogno indicato dalla fonte")
    for need in KIND_NEEDS.get(service_kind(card) or "", ()):
        found.setdefault(need, f"tipo di servizio: {(card.get('native_classifications') or {}).get('tipologia')}")
    text = " ".join(str(card.get(k) or "") for k in ("description", "offer_text", "service_title"))
    text += " " + " ".join(p.get("nome", "") for p in (card.get("native_classifications") or {}).get("prestazioni") or [])
    text = NOT_OFFERS.sub(" ", text)
    for need, pattern in OFFER_RES:
        if need not in found and (m := pattern.search(text)):
            found[need] = f"testo: «{m.group(0)}»"
    return [{"need": n, "basis": b} for n, b in found.items()]


STREET_WORDS = [(r"\bcirc\.?\s*ne\b|\bcirc\.(?=\s|\w)", "circonvallazione"), (r"\bv\.?\s?le\b", "viale"), (r"\bp\.?\s?(?:zz?a|za)\b", "piazza"),
                (r"\bp\.?\s?le\b", "piazzale"), (r"\bl\.?\s?go\b", "largo"), (r"\bl\.?\s?re\b", "lungotevere"), (r"\bc\.?\s?so\b", "corso"),
                (r"\bv\.(?=\s|[a-z])", "via "), (r"\bss?\.\s*", "san "), (r"\bsant[oa']?\b", "san"), (r"\bsanta\b", "san")]
STREET_TYPE = r"via|viale|piazza|piazzale|largo|lungotevere|lungomare|circonvallazione|corso|vicolo|borgo|salita|strada|clivo|galleria|parco|piazzetta"
ADDRESS = re.compile(rf"\b({STREET_TYPE})\s+([a-z' .]+?)[\s,]+(?:n\.?\s*)?(\d+(?:\s*[a-z]\b)?(?:\s*[/-]\s*\d+)*)", re.I)
NAME_STOP = {"di", "del", "della", "dello", "dei", "degli", "delle", "d", "de", "da", "dal", "la", "il", "lo", "le", "e"}
TITLES = {"cardinale", "cardinal", "card", "don", "padre", "papa", "beato", "san", "mons", "monsignor", "dottor", "dott",
          "generale", "gen", "ammiraglio", "maresciallo", "presidente", "onorevole", "professor", "prof", "avvocato"}
STREET_TYPE_EQUIVALENT = {"piazzetta": "piazza"}


def address_parts(address: str | None) -> tuple[str, frozenset[str], str, frozenset[str], str] | None:
    """(street type, name words without initials/titles, last word, house numbers, words joined in order)."""
    text = fold(address)
    for pattern, full in STREET_WORDS:
        text = re.sub(pattern, full, text)
    m = ADDRESS.search(re.sub(r"\s+", " ", text))
    if not m:
        return None
    words = [w for w in re.split(r"[\s.']+", m.group(2)) if w and w not in NAME_STOP]
    if not words:
        return None
    numbers = frozenset(re.findall(r"\d+", m.group(3)))
    kind = STREET_TYPE_EQUIVALENT.get(m.group(1), m.group(1))
    kept = [w for w in words if len(w) > 1 and w not in TITLES]
    return kind, frozenset(kept), words[-1], numbers, "".join(kept)


def address_relation(a: dict[str, Any], b: dict[str, Any]) -> str:
    """"same" (same street and a common house number), "street" (same street, other number),
    "conflict" (both readable, other streets) or "unknown".

    Initials, titles, joined words and abbreviations are tolerated: "Via A. Farnese, 17" =
    "Via Alessandro Farnese 17", "Circ.ne Trionfale 19" = "Circonvallazione Trionfale, 19",
    "Via di Grottaperfetta, 610" = "Via di Grotta Perfetta, 610", "Via Cardinal Ginnasi" =
    "Via Cardinale Domenico Ginnasi", "Piazzetta" = "Piazza", "n. 25" = "25"; "Via Nicola
    Stame, 160/162" shares 162 with "VIA NICOLA STAME, 162". Two identical texts without a
    readable number ("Via dei Feltreschi ang. Via Bravetta") are the same address.
    """
    raw_a, raw_b = ((x.get("place") or {}).get("address") for x in (a, b))
    pa, pb = address_parts(raw_a), address_parts(raw_b)
    if not pa or not pb:
        same_text = raw_a and raw_b and re.sub(r"\W+", " ", fold(raw_a)).strip() == re.sub(r"\W+", " ", fold(raw_b)).strip()
        return "same" if same_text else "unknown"
    by_words = pa[2] == pb[2] and (pa[1] <= pb[1] or pb[1] <= pa[1])
    glued = pa[4] == pb[4]  # "grottaperfetta" = "grotta" + "perfetta"
    same_street = pa[0] == pb[0] and (by_words or glued)
    if not same_street:
        return "conflict"
    return "same" if pa[3] & pb[3] else "street"


PRECISE = {"geocoded_matched_house", "geocoded_matched_poi", "source_point"}


def precise(card: dict[str, Any]) -> bool:
    """Position at a house number or named place (not a street-level estimate)."""
    return (card.get("placement") or {}).get("status") in PRECISE


POSITION_POINTS = {"geocoded_matched_house": 2, "geocoded_manual": 2, "geocoded_matched_poi": 2, "source_point": 2,
                   "geocoded_matched_street": 1}


def completeness(card: dict[str, Any]) -> tuple[int, list[str]]:
    """Score and list of the fields a card fills (higher is more complete)."""
    have, points = [], 0
    description = card.get("description") or ""
    if description:
        points += 1 + min(len(description) // 200, 2)
        have.append("descrizione")
    contacts = card.get("contacts") or []
    if contacts:
        points += min(len(contacts), 3)
        have.append(f"{len(contacts)} contatti")
    hours = card.get("hours_display") or {}
    if any(d.get("intervals") for d in hours.get("days", [])):
        points += 3
        have.append("orari strutturati")
    elif hours.get("raw_text") or card.get("hours_raw"):
        points += 2
        have.append("orari (testo)")
    if (card.get("place") or {}).get("address"):
        points += 1
        have.append("indirizzo")
    precision = POSITION_POINTS.get((card.get("placement") or {}).get("status") or "", 0)
    if precision:
        points += precision
        have.append("posizione al civico" if precision == 2 else "posizione sulla via")
    access = card.get("access_display") or {}
    if access.get("sections") or access.get("texts"):
        points += 1
        have.append("accesso/destinatari")
    if specific_words(card):  # a named service ("CAV Alessia e Martina Capasso") over a generic title
        points += 1
        have.append("nome specifico")
    return points, have


def _enrichment(primary: dict[str, Any], other: dict[str, Any]) -> list[str]:
    """What the other card would add to the primary."""
    adds = []
    known = {re.sub(r"\D", "", c.get("value") or "")[-9:] or (c.get("value") or "").lower() for c in primary.get("contacts") or []}
    extra = [c["value"] for c in other.get("contacts") or [] if (re.sub(r"\D", "", c.get("value") or "")[-9:] or (c.get("value") or "").lower()) not in known]
    if extra:
        adds.append("contatti: " + ", ".join(extra[:4]))
    p_hours, o_hours = completeness(primary)[1], completeness(other)[1]
    if not any(h.startswith("orari") for h in p_hours) and any(h.startswith("orari") for h in o_hours):
        adds.append("orari")
    if not primary.get("description") and other.get("description"):
        adds.append("descrizione")
    elif other.get("description") and len(other["description"]) > 1.5 * len(primary.get("description") or ""):
        adds.append("descrizione più ampia")
    if "posizione al civico" in o_hours and "posizione al civico" not in p_hours:
        adds.append("posizione più precisa")
    if "accesso/destinatari" in o_hours and "accesso/destinatari" not in p_hours:
        adds.append("accesso/destinatari")
    needs = {n["need"] for n in proposed_needs(primary)}
    more = [n["need"] for n in proposed_needs(other) if n["need"] not in needs]
    if more:
        adds.append("bisogni: " + ", ".join(more))
    return adds


GENERIC_WORDS = set("""servizio servizi sportello centro sede punto ambulatorio poliambulatorio medicina generale corsi corso
italiano lingua di del della per e a il la lo le i gli in con su da sociale sanitario sanitari sociosanitari socio igiene
personale mensa accoglienza ascolto orientamento lavoro consultorio familiare stp eni rilascio roma asl municipio
col cav cpi serd ser rm1 rm2 rm3 rm4 rm5 rm6 uosd uoc immigrati migranti rifugiati stranieri diocesano diocesana
parrocchia parrocchiale associazione onlus odv aps cooperativa coop presso casa via viale piazza largo""".split())


def specific_words(card: dict[str, Any]) -> set[str]:
    """Title words that are not the service type itself ("Igiene personale" has none).

    Only the title: a generic card's facility is often the umbrella organisation.
    """
    text = fold(card.get("service_title") or "")
    type_words = set(re.findall(r"[a-z]+", fold((card.get("native_classifications") or {}).get("tipologia"))))
    address_words = set(re.findall(r"[a-z]+", fold((card.get("place") or {}).get("address"))))
    return {w for w in re.findall(r"[a-z]{3,}", text)} - GENERIC_WORDS - type_words - address_words


LABELS = {"same_service": "Stesso servizio", "same_place": "Stesso luogo, servizi diversi", "different": "Diversi", "unsure": "Non so"}


def propose(pair: dict[str, Any], a: dict[str, Any], b: dict[str, Any], org_contacts: bool) -> dict[str, Any]:
    """Proposed decision for one scored pair (`pair` holds the review facts)."""
    kind_a, kind_b = service_kind(a), service_kind(b)
    same_kind = compatible_kinds(kind_a, kind_b) or (pair.get("same_type") and not (kind_a in KINDS.values() and kind_b in KINDS.values()))
    distance = pair.get("distance_m")
    site_contact = bool(pair.get("shared_contacts")) and not org_contacts
    similar = pair.get("name_similarity", 0) >= 0.25 or "stesso nome proprio" in pair.get("evidence", [])
    very_similar = pair.get("name_similarity", 0) >= 0.5 or "stesso nome proprio" in pair.get("evidence", [])
    both_precise = precise(a) and precise(b)
    close = distance is not None and both_precise and distance <= 15
    relation = address_relation(a, b)
    same_address = pair.get("same_address") or relation == "same"
    if site_contact and relation == "conflict":
        site_contact = False  # one number for two printed sites (a network line): not one structure
        reasons_contact = "contatto in comune ma indirizzi diversi"
    else:
        reasons_contact = None
    same_structure = same_address or (close and relation != "conflict") or site_contact
    near = relation == "street" or ("stessa via" in pair.get("evidence", [])) or (distance is not None and both_precise and distance <= 60)
    needs_a = {n["need"] for n in proposed_needs(a)}
    needs_b = {n["need"] for n in proposed_needs(b)}
    own_a, own_b = (a.get("category") or {}).get("slug"), (b.get("category") or {}).get("slug")
    mentioned = (own_b in needs_a and own_b != own_a) or (own_a in needs_b and own_a != own_b)
    reasons = []
    if same_address:
        reasons.append("stesso indirizzo e civico")
    elif close:
        reasons.append(f"a {distance} m (posizioni al civico)")
    elif distance is not None and distance <= 25:
        reasons.append(f"a {distance} m ma posizione stimata sulla via: non prova la stessa struttura")
    if site_contact:
        reasons.append("stesso contatto della sede")
    elif reasons_contact:
        reasons.append(reasons_contact)
    elif pair.get("shared_contacts"):
        reasons.append("contatto in comune ma usato per più sedi")
    reasons.append(f"stesso tipo ({kind_a})" if same_kind else f"tipi diversi ({(a.get('native_classifications') or {}).get('tipologia')} / {(b.get('native_classifications') or {}).get('tipologia')})")
    if similar:
        reasons.append(f"nomi simili ({pair.get('name_similarity')})")

    words_a, words_b = specific_words(a), specific_words(b)
    other_names = bool(words_a and words_b and not words_a & words_b)
    if same_structure and same_kind and other_names and not site_contact:
        decision, confidence = "same_place", "media"
        reasons.append("stesso tipo ma nomi diversi: forse due enti nella stessa sede")
    elif same_structure and same_kind:
        via_generic = kind_a != kind_b  # e.g. a generic ASL site and its STP/ENI desk: never "alta"
        decision, confidence = "same_service", "alta" if (similar or site_contact) and not via_generic else "media"
        if via_generic:
            reasons.append("una delle due schede è generica (sede o settore): verificare quale servizio")
    elif same_structure:
        decision, confidence = "same_place", "alta" if (same_address and (similar or site_contact)) else "media"
        if mentioned:
            reasons.append("una scheda menziona anche il servizio dell'altra")
    elif near and same_kind and very_similar:
        decision, confidence = "same_service", "media"
    elif pair.get("shared_contacts") and not near:
        decision, confidence = ("unsure", "bassa") if same_kind and very_similar else ("different", "media")
        reasons.append("probabilmente un'altra sede della stessa organizzazione")
    elif same_kind and very_similar:
        decision, confidence = "unsure", "bassa"
        reasons.append("stesso servizio per nome e tipo, ma indirizzi non confrontabili: verificare l'indirizzo")
    else:
        decision, confidence = "different", "alta" if not (same_kind or similar) else "media"
    result = {"decision": decision, "label": LABELS[decision], "confidence": confidence, "reasons": reasons,
              "kinds": [kind_a, kind_b], "needs": {"a": proposed_needs(a), "b": proposed_needs(b)}}
    if decision == "same_service":
        (sa, ha), (sb, hb) = completeness(a), completeness(b)
        primary, other = (a, b) if sa >= sb else (b, a)
        result["primary"] = {"id": primary["id"], "score": max(sa, sb), "fields": ha if primary is a else hb}
        result["enrich"] = _enrichment(primary, other)
    return result
