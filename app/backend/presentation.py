"""Interpret source claims for readable preview cards, preserving uncertainty.

access_sections separates positive claims from unknown flag semantics; weekly_hours
renders source intervals without inventing closed days; coverage records every native
field's source population and product use, including unresolved source omissions.
"""

from __future__ import annotations

import re
from typing import Any

DAYS = [
    ("lun", "Lunedì"),
    ("mar", "Martedì"),
    ("mer", "Mercoledì"),
    ("gio", "Giovedì"),
    ("ven", "Venerdì"),
    ("sab", "Sabato"),
    ("dom", "Domenica"),
]
PROCEDURE = {
    "appuntamento": "Su appuntamento",
    "colloquio_di_ingresso": "Colloquio di ingresso",
    "prenotazione_sul_posto": "Prenotazione sul posto",
    "accesso_su_valutazione": "Accesso su valutazione",
    "invio_servizi_territoriali": "Invio dei servizi territoriali",
    "segnalazione": "Segnalazione",
    "tesseramento": "Tesseramento",
}
DOCUMENTS = {
    "con_documenti": "Documenti",
    "documento_di_identita": "Documento di identità",
    "codice_fiscale": "Codice fiscale",
    "isee_richiesto": "ISEE richiesto",
    "permesso_di_soggiorno": "Permesso di soggiorno",
    "residenza": "Residenza",
    "lingua_italiana": "Lingua italiana",
    "italiano_fluente": "Italiano fluente",
}
COST = {"a_pagamento": "A pagamento", "con_contributo": "Con contributo"}
AUDIENCE = {
    "18_50": "Persone tra 18 e 50 anni",
    "cittadino_eu": "Cittadini UE",
    "cittadino_italiano": "Cittadini italiani",
    "dipendenza": "Dipendenze",
    "dipendenza_da_gioco_azzardo": "Dipendenza da gioco d’azzardo",
    "dipendenza_da_sostanze": "Dipendenza da sostanze",
    "disabili": "Persone con disabilità",
    "donna": "Donne",
    "donna_in_gravidanza": "Donne in gravidanza",
    "extracomunitari": "Cittadini non UE",
    "lgbtqia+": "Persone LGBTQIA+",
    "maggiore_età": "Persone maggiorenni",
    "migranti": "Persone migranti",
    "migranti_forzati": "Persone migranti forzate",
    "minori": "Minori",
    "minori_non_accompagnati": "Minori non accompagnati",
    "neomaggiorenni": "Neomaggiorenni",
    "nuclei_familiari": "Nuclei familiari",
    "nuclei_monogenitoriali": "Nuclei monogenitoriali",
    "over_50": "Persone con più di 50 anni",
    "over_65": "Persone con più di 65 anni",
    "senza_documenti": "Persone senza documenti",
    "senza_fissa_dimora": "Persone senza dimora",
    "tossicodipendenti": "Dipendenza da sostanze (voce della fonte)",
    "uomo": "Uomini",
    "vittima_di_tortura": "Vittime di tortura",
    "vittima_di_violenza": "Vittime di violenza",
}
CLOCK = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


def access_sections(flags: dict[str, Any]) -> dict[str, Any]:
    """Group positive source claims; never turn false/unset flags into negative rules."""
    sections = []
    for key, title, labels in [
        ("procedure", "Come accedere", PROCEDURE),
        ("documents", "Documenti e requisiti indicati", DOCUMENTS),
        ("audience", "Destinatari indicati", AUDIENCE),
        ("cost", "Costo indicato", COST),
    ]:
        entries = [
            {
                "code": code,
                "label": label,
                "value": True,
                "status": "source_claim_unreviewed",
            }
            for code, label in labels.items()
            if flags.get(code) is True
        ]
        if entries:
            sections.append({"code": key, "title": title, "entries": entries})
    known = set(PROCEDURE) | set(DOCUMENTS) | set(AUDIENCE) | set(COST)
    other = [
        {"code": k, "label": k.replace("_", " "), "value": v}
        for k, v in flags.items()
        if (k not in known and v is True) or (not isinstance(v, bool) and v is not None)
    ]
    if other:
        sections.append(
            {
                "code": "unresolved",
                "title": "Indicazioni da interpretare",
                "entries": other,
            }
        )
    return {
        "sections": sections,
        "unselected_count": sum(v is False or v is None for v in flags.values()),
        "note": "Indicazioni della fonte da verificare. Un flag non selezionato non significa assenza di requisiti; i destinatari indicati non implicano esclusività.",
        "cost_state": (
            "source_claim" if any(flags.get(k) is True for k in COST) else "unknown"
        ),
    }


def weekly_hours(raw: Any, corrections: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Expose readable weekday intervals and diagnostics without open-now claims.

    An interval ending before it starts crosses midnight (a night shelter 19:00–08:00,
    user decision 2026-11-15) and is marked `overnight`; 00:00–23:59 reads as 24 hours.
    `raw` may be the importer's curated hours; `corrections` are listed as warnings so the
    source's own value stays visible.
    """
    raw = raw if isinstance(raw, dict) else {}
    rows = []
    warnings = []
    for key, label in DAYS:
        value = raw.get(key)
        intervals = []
        issues = []
        if value is not None and not isinstance(value, list):
            issues.append("Formato del giorno da verificare")
        for interval in value if isinstance(value, list) else []:
            if not isinstance(interval, dict):
                issues.append("Intervallo da verificare")
                continue
            start, end = interval.get("inizio"), interval.get("fine")
            valid = (
                isinstance(start, str)
                and isinstance(end, str)
                and bool(CLOCK.fullmatch(start))
                and bool(CLOCK.fullmatch(end))
            )
            note = None
            overnight = valid and end < start
            shown = f'{start or "?"} – {end or "?"}'
            if not valid:
                note = "Formato orario da verificare"
            elif end == start:
                note = "Apertura e chiusura coincidono: da verificare"
            elif overnight:
                shown += " (del giorno dopo)"
            elif (start, end) == ("00:00", "23:59"):
                shown = "Aperto 24 ore"
            if note:
                issues.append(note)
            intervals.append(
                {
                    "opens_raw": start,
                    "closes_raw": end,
                    "label": shown,
                    "overnight": overnight,
                    "review_note": note,
                    "raw": interval,
                }
            )
        rows.append(
            {
                "day": key,
                "label": label,
                "intervals": intervals,
                "state": "declared" if intervals else "unknown",
                "issues": issues,
            }
        )
    days = dict(DAYS)
    for item in corrections or []:
        source, fixed = item.get("raw") or {}, item.get("corrected") or {}
        warnings.append(
            f'{days.get(item.get("day"), item.get("day"))}: la fonte indica {source.get("inizio")} – {source.get("fine")}, '
            f'letto come {fixed.get("inizio")} – {fixed.get("fine")} (correzione in revisione).'
        )
    extra = {key: value for key, value in raw.items() if key not in dict(DAYS)}
    if extra:
        warnings.append(
            "Sono presenti giorni o campi non riconosciuti: consultare il dato originale"
        )
    return {
        "days": rows,
        "scope": "unknown",
        "complete": False,
        "open_now": None,
        "warnings": warnings,
        "extra_fields": extra,
        "note": "Orari dichiarati da Helpinet; ambito e completezza da verificare. Giorni senza orari: considerati chiusi.",
    }


def placement(payload: dict[str, Any], point: dict[str, Any] | None, derived: bool = False) -> dict[str, str]:
    """Classify directory eligibility from explicit delivery mode, never missing geometry.

    `derived`: the point is a same-group sibling's at the same address (importer v0.3).
    """
    mode = payload.get("delivery_mode")
    if mode in {"telephone", "online"}:
        return {"section": "directory", "status": mode, "label": "Servizio a distanza"}
    if point is not None and derived:
        return {
            "section": "services",
            "status": "source_group_sibling",
            "label": "Coordinate di un altro servizio della stessa struttura allo stesso indirizzo · da verificare",
            "issue": "ok",
        }
    if point is not None:
        return {
            "section": "services",
            "status": "source_point",
            "label": "Coordinate della fonte da verificare",
            "issue": "ok",
        }
    if payload.get("location", {}).get("address_raw"):
        return {
            "section": "services",
            "status": "needs_geocoding",
            "label": "Coordinate non indicate dalla fonte · posizione da completare",
            "issue": "no_coordinates",
        }
    return {
        "section": "services",
        "status": "unresolved",
        "label": "Modalità e posizione da verificare",
        "issue": "no_address",
    }


def coverage(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Measure field coverage independently from semantic correctness or source completeness."""
    raw = [r["payload"].get("source_values", {}) for r in rows]
    fields = sorted({key for item in raw for key in item})
    usage = {
        "identifier": (
            "Identificativo della fonte",
            "Provenienza e identità sorgente",
            False,
        ),
        "nome": ("Nome originale", "Struttura / provenienza / ricerca", True),
        "bisogno": ("Bisogno", "Categoria e filtro", True),
        "tipologia": ("Tipologia", "Titolo servizio, tipo e filtro", True),
        "prestazioni": ("Prestazioni", "Sintesi, elenco e filtro", True),
        "posizione": ("Posizione", "Mappa, indirizzo, distanza, itineranza", True),
        "numeri_telefono": ("Telefoni", "Contatti del servizio", True),
        "email": ("Email", "Contatti del servizio", True),
        "orari_apertura": ("Orari", "Tabella con giorni sconosciuti espliciti", True),
        "criteri_accesso": (
            "Accesso",
            "Indicazioni positive per ambito; altri flag conservati",
            True,
        ),
        "descrizione": (
            "Descrizione originale",
            "Testo originale distinto dalla sintesi derivata",
            True,
        ),
        "ente": ("Ente", "Organizzazione dichiarata, ruolo sconosciuto", True),
    }
    measured = []
    for field in fields:
        label, display, search = usage.get(
            field, (field, "Evidenza originale · interpretazione in sospeso", False)
        )
        present = sum(field in r for r in raw)
        populated = sum(
            field in r and r[field] is not None and r[field] not in ("", [], {})
            for r in raw
        )
        measured.append(
            {
                "field": field,
                "label": label,
                "total": len(raw),
                "present": present,
                "populated_at_source": populated,
                "missing_at_source": len(raw) - populated,
                "retained": present,
                "display": display,
                "searchable": search,
                "interpretation": (
                    "partial_source_claims" if field in usage else "pending"
                ),
                "native_values": len({str(r[field]) for r in raw if field in r}),
            }
        )
    flags = sorted({key for r in raw for key in r.get("criteri_accesso", {})})
    flag_counts = [
        {
            "field": key,
            "true": sum(r.get("criteri_accesso", {}).get(key) is True for r in raw),
            "false": sum(r.get("criteri_accesso", {}).get(key) is False for r in raw),
            "group": next(
                (
                    title
                    for title, labels in [
                        ("procedure", PROCEDURE),
                        ("documents", DOCUMENTS),
                        ("audience", AUDIENCE),
                        ("cost", COST),
                    ]
                    if key in labels
                ),
                "unresolved",
            ),
        }
        for key in flags
    ]
    groups = {
        r["payload"]["source_group"]["external_key"]: r["payload"]["source_group"]
        for r in rows
        if r["payload"].get("source_group")
    }
    group_fields = sorted(
        {key for group in groups.values() for key in group.get("raw_fields", {})}
        | ({"servizi"} if groups else set())
    )
    return {
        "source": "helpinet",
        "services": len(rows),
        "source_groups": len(groups),
        "fields": measured,
        "group_fields": [
            {
                "field": key,
                "groups": len(groups),
                "retained": sum(
                    key in g.get("raw_fields", {}) or key == "servizi"
                    for g in groups.values()
                ),
                "display": (
                    "Contesto del gruppo / servizi collegati"
                    if key in {"identifier", "nome", "servizi"}
                    else "Evidenza originale del gruppo"
                ),
            }
            for key in group_fields
        ],
        "access_flags": flag_counts,
        "note": "Copertura del file selezionato: presenza, conservazione e uso non attestano correttezza o verifica operativa.",
    }
