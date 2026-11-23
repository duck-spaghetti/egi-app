"""Own preview behavior independently of HTTP request handling."""
from typing import Any
from . import taxonomy
from .projection import AREA, LANGUAGES, debug_positions, is_map_row, services, source_list
from .presentation import coverage
from .review import overlap_pairs
from .exceptions import PreviewError
from .schemas import PreviewSelection

class Preview:
    """Hide preview orchestration behind its actual operations."""


    def preview_services(self, selection: PreviewSelection, rows: list[dict[str, Any]]):
        """Return imported subjects only, never claim canonical approval or live availability.

        Services without a map point are left out (user decision, 2026-11-09) unless
        include_unplaced is set, which the review/debug view uses. Remote directory
        services (telephone/online) have no place by nature and are always kept.
        """
        if selection.area_id != 1:
            raise PreviewError(404, 'Area non disponibile nella preview')
        cards = services(rows)
        if not selection.include_unplaced:
            cards = [c for c in cards if self.is_placed(c)]
        return cards[:selection.limit]

    def is_placed(self, card: dict[str, Any]) -> bool:
        """A card is shown when it has a map point or is a remote directory service."""
        return bool((card.get('place') or {}).get('geometry')) or (card.get('placement') or {}).get('section') == 'directory'

    def preview_categories(self, rows: list[dict[str, Any]]):
        """Return the need tiles of the presentation taxonomy (v0.3) for the filters."""
        return taxonomy.need_categories()

    def preview_taxonomy(self):
        """Presentation vocabulary v0.3: need tiles, offers, audiences, access, meal times and paths."""
        return taxonomy.public_vocabulary()

    def preview_languages(self):
        """Return recovered UI catalog languages, independently of source content language."""
        return LANGUAGES

    def preview_areas(self):
        """Return explicit preview framing, without creating canonical territory entities."""
        return [AREA]

    def category_translations(self):
        """Keep native labels where no reviewed category translation exists."""
        return []

    def source_coverage(self, rows: list[dict[str, Any]]):
        """Report native field conservation and use without confusing completeness with accuracy."""
        return coverage(self.helpinet_rows(rows))

    def helpinet_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The coverage benchmark measures Helpinet's native fields only."""
        return [r for r in rows if not is_map_row(r)]

    def debug_sources(self, rows: list[dict[str, Any]]):
        """List displayed sources for the local position-check view (map ?debug=1)."""
        return source_list(rows)

    def debug_source_positions(self, source: str, rows: list[dict[str, Any]]):
        """All position candidates of one source, including those not shown as map points."""
        result = debug_positions(rows, source)
        if not result['total']:
            raise PreviewError(404, 'Fonte non presente nella preview')
        return result

    def review_overlaps(self, tiers: str, rows: list[dict[str, Any]]):
        """Cross-dataset candidate pairs among visible services (placed or not), for the duplicate review page."""
        wanted = {t for t in tiers.split(',') if t in {'A', 'B', 'C', 'D'}}
        pairs = [p for p in overlap_pairs(services(rows)) if p['tier'] in wanted]
        groups = {p['group']['id']: p['group'] for p in pairs if p.get('group')}
        return {'pairs': pairs, 'count': len(pairs), 'groups': len(groups), 'groups_over_two_sources': sum((1 for g in groups.values() if len(g['sources']) > 2)), 'note': 'Coppie da fonti diverse o da capitoli diversi della stessa guida; le decisioni restano nel browser finché non vengono registrate dal curatore.'}

    def points(self, rows):
        """Return source-preview points without claiming canonical identities."""
        return {place['id']: tuple(place['geometry']['coordinates'])
                for card in services(rows) if (place := card.get('place'))
                and place.get('id') and (place.get('geometry') or {}).get('type') == 'Point'}
