"""Prepare public directory responses from one configured coherent snapshot."""
from uuid import UUID
from .projection import cards, vocabulary, area, LANGUAGES
from .exceptions import DirectoryError
from .schemas import Discovery

class Directory:
    """Own public discovery, selection and response projection."""
    def __init__(self, db, policy):
        """Accept the selected reader and application profile."""
        self.db = db
        self.policy = policy

    def services(self, selection: Discovery):
        """Return bounded public cards for the configured area."""
        if selection.area_id != 1:
            raise DirectoryError(404)
        return cards(self.db.snapshot(selection.language), self.policy)[:selection.limit]

    def detail(self, identifier: UUID, language: str):
        """Select a public card or fail without disclosing hidden entities."""
        found = next((row for row in cards(self.db.snapshot(language), self.policy)
                      if row['id'] == str(identifier)), None)
        if found is None:
            raise DirectoryError(404)
        return found

    def vocabulary(self, language: str):
        """Return the selected public classification vocabulary."""
        return vocabulary(self.db.snapshot(language))

    def areas(self):
        """Return the configured public territory with safe fallback values."""
        return [area(self.db.snapshot(), self.policy)]

    def points(self):
        """Supply only currently public located places to local layers."""
        return {place['location_id']: (place['longitude'], place['latitude'])
                for row in self.db.snapshot()['services'] if (place := row.get('place'))
                and place.get('location_id') and place.get('longitude') is not None
                and place.get('latitude') is not None}
