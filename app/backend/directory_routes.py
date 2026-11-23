"""Expose bounded public HTTP discovery over the single configured Db facade."""
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from .directory_db import Db
from .directory import cards, vocabulary, area, LANGUAGES

def router(db: Db) -> APIRouter:
    """Provide public discovery endpoints over the configured facade, with bounded inputs."""
    result = APIRouter(prefix="/api/public")

    @result.get("/services")
    def services(area_id: int = 1, language: str = Query(default="it", max_length=16),
                 limit: int = Query(default=2000, ge=1, le=5000)):
        """Return approved, discoverable cards including services without map points."""
        if area_id != 1:
            raise HTTPException(404, "Area non disponibile")
        return cards(db.snapshot(language))[:limit]

    @result.get("/services/{identifier}")
    def detail(identifier: UUID, language: str = Query(default="it", max_length=16)):
        """Return a card only if it belongs to this configured public directory."""
        found = next((row for row in cards(db.snapshot(language)) if row["id"] == str(identifier)), None)
        if found is None:
            raise HTTPException(404, "Servizio non disponibile")
        return found

    @result.get("/categories")
    def categories(language: str = Query(default="it", max_length=16)):
        """Return categories from the adopted public vocabulary."""
        return vocabulary(db.snapshot(language))["needs"]

    @result.get("/taxonomy")
    def taxonomy(language: str = Query(default="it", max_length=16)):
        """Return public labels, excluding importer mapping rules."""
        return vocabulary(db.snapshot(language))

    @result.get("/areas")
    def areas():
        """Return the configured public territory."""
        return [area(db.snapshot())]

    @result.get("/languages")
    def languages():
        """Return the existing interface catalogs; language expansion belongs to B2."""
        return LANGUAGES

    @result.get("/category-translations")
    def category_translations():
        """Keep the existing frontend envelope; canonical labels carry their resolved text."""
        return []

    return result
