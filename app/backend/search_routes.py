"""Handle explicit address searches without leaking upstream details or input."""
import urllib.error
from fastapi import APIRouter, HTTPException
from .request_schemas import AddressSearch
from .geocoding import search_address
router=APIRouter()

@router.post("/api/preview/address-search")
def address_search(body: AddressSearch):
    """Resolve a submitted public address; never expose upstream error/query details."""
    if len(body.query.strip()) < 3:
        raise HTTPException(422, "Inserisci almeno tre caratteri")
    try:
        return {"results": search_address(body.query), "attribution": "© OpenStreetMap contributors"}
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        raise HTTPException(503, "Ricerca indirizzo non disponibile. Scegli un punto sulla mappa.") from None


