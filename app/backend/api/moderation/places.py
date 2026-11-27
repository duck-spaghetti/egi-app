"""Where a service is: choose or create its location, and create services (EGI-84).

A service points at a location; moving it changes only that service, never the
location or the other services there. A location or a service created here cites
what the person verified, recorded as an observation of the "Redazione EGI" source
(`editorial.record_observation`); the database publishes nothing without evidence.
A new location is published together with the first service that uses it. Sync only
updates what it created itself, so it leaves these alone.
"""
import copy
import json

from .desk import Refused

KINDS = ('address', 'building', 'site')
METHODS = ('phone_call', 'official_website', 'site_visit', 'document', 'other')
MAX_NOTE = 1000

LOCATIONS = '''SELECT l.entity_id::text AS location_id,n.original_text AS name,a.formatted AS address,
 p.revision_id IS NOT NULL AS published,
 (SELECT count(*) FROM governance.published_heads h JOIN data.service_places sp USING(revision_id) WHERE sp.location_id=l.entity_id) AS services
 FROM data.locations l LEFT JOIN governance.working_heads w USING(entity_id) LEFT JOIN governance.published_heads p USING(entity_id)
 JOIN data.location_revisions r ON r.revision_id=COALESCE(w.revision_id,p.revision_id)
 LEFT JOIN i18n.content_units n ON n.content_id=r.name_content_id
 LEFT JOIN LATERAL (SELECT x.formatted FROM data.addresses x WHERE x.revision_id=r.revision_id
  ORDER BY x.address_kind<>'physical',x.component_id LIMIT 1) a ON true
 WHERE n.original_text ILIKE %(q)s ESCAPE '\\' OR a.formatted ILIKE %(q)s ESCAPE '\\'
 ORDER BY n.original_text NULLS LAST,a.formatted,l.entity_id LIMIT 30'''
TERRITORIES = '''SELECT h.entity_id::text AS territory_id,n.original_text AS name FROM governance.published_heads h
 JOIN geo.territory_revisions r USING(revision_id) JOIN i18n.content_units n ON n.content_id=r.name_content_id
 ORDER BY n.original_text,h.entity_id'''
HEADS = '''SELECT (SELECT revision_id::text FROM governance.working_heads WHERE entity_id=%(e)s) AS working,
 (SELECT revision_id::text FROM governance.published_heads WHERE entity_id=%(e)s) AS public,
 EXISTS(SELECT FROM data.locations WHERE entity_id=%(e)s) AS location'''


def pattern(query: str) -> str:
    """Return an ILIKE pattern matching `query` literally."""
    return '%' + query.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


def find_locations(connection, query: str) -> list[dict]:
    """Find locations by name or address, published or still drafts."""
    return connection.execute(LOCATIONS, {'q': pattern(query)}).fetchall() if query.strip() else []


def territories(connection) -> list[dict]:
    """Return the published territories a new location or service can belong to."""
    return connection.execute(TERRITORIES).fetchall()


def heads(connection, entity: str) -> dict:
    """Return a location's working and public revisions; refuse an unknown location."""
    found = connection.execute(HEADS, {'e': entity}).fetchone()
    if not found['location'] or not (found['working'] or found['public']):
        raise Refused('location_not_found')
    return found


def chosen_territory(connection, form: dict, prefix: str) -> str:
    """Return the territory the form names, or the only one there is."""
    known = [row['territory_id'] for row in territories(connection)]
    wanted = form.get(prefix + 'territory') or (known[0] if len(known) == 1 else '')
    if wanted not in known:
        raise Refused('territory_required')
    return wanted


def observation(connection, kind: str, observed: dict, form: dict) -> dict:
    """Record what the person verified and how; return supporting evidence by attribute."""
    method, note = form.get('method', ''), form.get('note', '').strip()
    if method not in METHODS:
        raise Refused('method_required')
    if len(note) > MAX_NOTE:
        raise Refused('note_too_long')
    made = connection.execute('SELECT editorial.record_observation(%s,%s,%s,%s) AS made',
                              (kind, json.dumps(observed), method, note or None)).fetchone()['made']
    return {name: [{'assertion_id': assertion, 'role': 'supporting'}] for name, assertion in made.items()}


def number(value: str) -> float | None:
    """Read a coordinate as typed, with a comma or a point."""
    value = value.strip().replace(',', '.')
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        raise Refused('invalid_point') from None


def location_values(form: dict) -> dict:
    """Read a new location from the form: name, kind, street address and point."""
    name = form.get('location_name', '').strip()
    street, postal, town = (form.get('location_' + k, '').strip() for k in ('street', 'postal_code', 'locality'))
    latitude, longitude = number(form.get('location_latitude', '')), number(form.get('location_longitude', ''))
    if (latitude is None) != (longitude is None) or (latitude is not None and not (-90 <= latitude <= 90 and -180 <= longitude <= 180)):
        raise Refused('invalid_point')
    formatted = ', '.join(part for part in (street, ' '.join(p for p in (postal, town) if p)) if part)
    if not name and not street:
        raise Refused('location_incomplete')
    values = {'name': name, 'location_kind': form.get('location_kind') if form.get('location_kind') in KINDS else 'address',
              'address': formatted, 'street': street, 'postal_code': postal, 'locality': town,
              'latitude': latitude, 'longitude': longitude}
    return {key: value for key, value in values.items() if value not in ('', None)}


def create_location(connection, form: dict, note: str) -> str:
    """Create a location draft from the form, citing the person's observation; return its entity."""
    values = location_values(form)
    territory = chosen_territory(connection, form, 'location_')
    cited = observation(connection, 'location', values, form)
    body = {'location_kind': values['location_kind'], 'coordinate_state': 'known' if 'latitude' in values else 'unknown',
            'territories': [territory], 'original_language': 'it',
            'evidence': {'record': [item for items in cited.values() for item in items],
                         'location_kind': cited['location_kind'], 'territories': []}}
    if 'name' in values:
        body['name'] = values['name']
        body['evidence']['name'] = cited['name']
    if 'latitude' in values:
        body.update(latitude=values['latitude'], longitude=values['longitude'])
        body['evidence']['coordinates'] = cited['latitude'] + cited['longitude']
    if 'address' in values:
        address = {'address_kind': 'physical', 'formatted': values['address'], 'country_code': 'IT',
                   'normalization_state': 'raw', 'evidence': cited['address']}
        address.update({'line1': values.get('street'), 'postal_code': values.get('postal_code'), 'locality': values.get('locality')})
        body['addresses'] = [{key: value for key, value in address.items() if value is not None}]
    revision = connection.execute("SELECT governance.save_revision('location',NULL,NULL,NULL,%s,%s) AS r",
                                  (json.dumps(body), note)).fetchone()['r']
    return connection.execute('SELECT entity_id::text FROM governance.entity_revisions WHERE revision_id=%s',
                              (revision,)).fetchone()['entity_id']


def location_territories(connection, location: str) -> list[str]:
    """Return the territories of a location's current revision."""
    found = heads(connection, location)
    body = connection.execute('SELECT editorial.revision_body(%s) AS body', (found['working'] or found['public'],)).fetchone()['body']
    return body.get('territories', [])


def placed(base: dict, location: str, where: list[str]) -> dict:
    """Return the body with its place moved to `location`; only this service changes."""
    body = copy.deepcopy(base)
    place = body.get('place') or {}
    if place.get('location_id') == location:
        raise Refused('no_changes')
    moved = {'location_id': location, 'evidence': []}
    if place.get('component_id'):
        moved['component_id'] = place['component_id']
    body['place'] = moved
    if not body.get('territories') and where:
        body['territories'] = list(where)
        body.setdefault('evidence', {})['territories'] = []
    return body


def publish_new_location(connection, body: dict, summary: str) -> None:
    """Publish the service's location first when it has never been published."""
    location = (body.get('place') or {}).get('location_id')
    if not location:
        return
    found = heads(connection, location)
    if found['public'] is None and found['working']:
        decision = connection.execute("SELECT governance.review_revision(%s,NULL,'approved',%s) AS d",
                                      (found['working'], summary)).fetchone()['d']
        connection.execute('SELECT governance.publish_revision(%s,%s,NULL)', (found['working'], decision))
