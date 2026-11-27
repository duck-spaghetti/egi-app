"""Describe the frozen private field grammar and authorized presentation references.

Reuse the canonical workspace's selected vocabularies. This presentation dictionary
never validates or writes canonical data; PostgreSQL remains authoritative.
"""
from ..moderation import hours, workspace, places

SCALARS = {
    'service': ('name', 'description', 'original_language', 'delivery_mode', 'operational_status', 'cost_state', 'cost_note', 'valid_from', 'valid_until', 'closure_date', 'closure_reason'),
    'location': ('name', 'original_language', 'location_kind', 'latitude', 'longitude', 'coordinate_state', 'selected_geocoding_result_id', 'parent_location_id'),
}
COMPONENTS = {
    'contacts': ('channel_type', 'value', 'normalized_value', 'purpose_code', 'label', 'sort_order', 'is_public'),
    'addresses': ('address_kind', 'formatted', 'line1', 'locality', 'postal_code', 'administrative_area', 'country_code', 'normalization_state'),
    'organizations': ('organization_id', 'role_code'),
    'conditions': ('condition_kind', 'requirement_state', 'details'),
    'contact_links': ('target_entity_id', 'target_contact_component_id', 'purpose_code', 'label'),
    'languages': ('language_code', 'availability_kind', 'note'),
    'coverage': ('territory_id', 'geometry_wkt', 'description'),
    'classifications': ('adoption_id', 'term_id'),
    'place': ('location_id', 'territory_id', 'area_description'),
    'schedules': ('scope', 'timezone', 'contact_component_id', 'valid_from', 'valid_until', 'completeness', 'days'),
    'days': ('weekday', 'state', 'completeness', 'intervals'),
    'intervals': ('opens', 'closes', 'end_day_offset'),
    'calendar_links': ('schedule_id', 'calendar_id', 'effects'),
    'effects': ('event_version_id', 'kind', 'intervals'),
}
ARRAYS = {
    'service': ('contacts', 'conditions', 'schedules', 'organizations', 'territories', 'contact_links', 'languages', 'coverage', 'classifications', 'calendar_links'),
    'location': ('addresses', 'contacts', 'organizations', 'territories', 'schedules', 'calendar_links'),
}
CHOICES = {**workspace.CHOICES, 'channel_type': workspace.CHANNELS,
    'condition_kind': workspace.CONDITION_KINDS, 'requirement_state': workspace.REQUIREMENTS,
    'scope': hours.SCOPES, 'state': hours.DAY_STATES, 'completeness': hours.COMPLETENESS,
    'coordinate_state': ('known', 'unknown', 'uncertain'), 'weekday': tuple(range(1, 8)), 'end_day_offset': (0, 1)}


def dictionary():
    """Return presentation metadata without introducing defaults for unknown facts."""
    return {'scalars': SCALARS, 'components': COMPONENTS, 'arrays': ARRAYS, 'choices': CHOICES,
            'numbers': ('latitude', 'longitude', 'weekday', 'end_day_offset', 'sort_order'),
            'dates': ('valid_from', 'valid_until', 'closure_date'), 'times': ('opens', 'closes')}


def references(connection):
    """Reuse canonical territory/term reads for explicit operator classification."""
    areas = places.territories(connection)
    terms = connection.execute(workspace.TERMS, ([area['territory_id'] for area in areas],)).fetchall() if areas else []
    return {'territories': areas, 'classifications': terms}
