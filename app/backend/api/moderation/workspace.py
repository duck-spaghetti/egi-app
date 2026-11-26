"""The service workspace: edit public fields beside their evidence, save, compare, publish (EGI-83, EGI-84).

Every edit starts from the complete body of the revision the page showed
(`editorial.revision_body`), because `save_revision` replaces the whole aggregate. The
page carries the working and public revisions it was built on; the database refuses a
save or publication when either has moved, and the page then shows the person's
unsaved values instead of overwriting anyone's work. Hours are edited here as
structured schedules (`hours`); the place is chosen or created apart (`places`), and a
new location is published with the service. Contact protections are applied by the database on public reads, so an edit can
neither weaken nor release them.
"""
import copy
import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from . import hours, places
from .desk import Refused
from .service import Moderation, PATH

router = APIRouter()
SCALARS = ('name', 'description', 'delivery_mode', 'operational_status', 'cost_state', 'cost_note')
TEXTS = ('name', 'description', 'cost_note')
CHOICES = {'delivery_mode': ('in_person', 'telephone', 'online', 'itinerant'),
           'operational_status': ('active', 'inactive', 'temporarily_closed', 'defunct', 'unknown'),
           'cost_state': ('free', 'paid', 'variable', 'unknown')}
CHANNELS = ('phone', 'email', 'web', 'whatsapp', 'other')
CONDITION_KINDS = ('appointment', 'referral', 'document', 'eligibility', 'other')
REQUIREMENTS = ('required', 'not_required', 'conditional', 'unknown')
COMPARED = SCALARS + ('needs', 'contacts', 'conditions', 'hours', 'place')
MAX_ROWS = 50
SOURCE_TEXT = 4000  # characters of one source record shown in the evidence panel

SEARCH = '''SELECT s.entity_id::text AS service_id,n.original_text AS name,p.revision_id IS NOT NULL AS published,
 w.revision_id IS NOT NULL AND w.revision_id IS DISTINCT FROM p.revision_id AS has_draft
 FROM data.services s LEFT JOIN governance.working_heads w USING(entity_id) LEFT JOIN governance.published_heads p USING(entity_id)
 JOIN data.service_revisions r ON r.revision_id=COALESCE(w.revision_id,p.revision_id)
 LEFT JOIN i18n.content_units n ON n.content_id=r.name_content_id
 WHERE n.original_text ILIKE %s ESCAPE '\\' ORDER BY n.original_text,s.entity_id LIMIT 50'''
HEADS = '''SELECT (SELECT revision_id::text FROM governance.working_heads WHERE entity_id=%(e)s) AS working,
 (SELECT revision_id::text FROM governance.published_heads WHERE entity_id=%(e)s) AS public,
 EXISTS(SELECT FROM data.services WHERE entity_id=%(e)s) AS service'''
# Terms of the taxonomy releases adopted where the service is on the map.
TERMS = '''SELECT a.adoption_id::text,rt.term_id::text,c.original_text AS name FROM taxonomy.territory_adoptions a
 JOIN taxonomy.release_terms rt ON rt.release_id=a.release_id
 JOIN taxonomy.term_revisions tr ON tr.revision_id=rt.term_revision_id
 JOIN i18n.revision_content_links l ON l.revision_id=tr.revision_id AND l.field_code='name'
 JOIN i18n.content_units c ON c.content_id=l.content_id
 WHERE a.territory_id=ANY(%s::uuid[]) AND (a.effective_until IS NULL OR a.effective_until>=current_date)
 ORDER BY c.original_text,a.adoption_id'''
EVIDENCE = '''SELECT a.assertion_id::text,a.attribute_code,a.normalized_value,a.certainty,r.name AS source,
 rv.record_version_id::text AS record,rv.raw_payload FROM sources.assertions a
 JOIN sources.normalized_subjects s ON s.subject_id=a.subject_id
 JOIN sources.record_versions rv ON rv.record_version_id=s.record_version_id
 JOIN sources.datasets d ON d.dataset_id=rv.dataset_id JOIN sources.registry r ON r.source_id=d.source_id
 WHERE a.assertion_id=ANY(%s::uuid[]) ORDER BY r.name,a.attribute_code,a.assertion_id'''
LOCATION = '''SELECT editorial.revision_body(COALESCE((SELECT revision_id FROM governance.working_heads WHERE entity_id=%(l)s),
 (SELECT revision_id FROM governance.published_heads WHERE entity_id=%(l)s))) AS body'''


def moderation(request: Request) -> Moderation:
    """Return this application's moderation resources."""
    return request.app.state.resources.moderation


def assertion_ids(value) -> set[str]:
    """Collect every assertion cited anywhere in a body."""
    if isinstance(value, dict):
        found = {value['assertion_id']} if 'assertion_id' in value else set()
        return found.union(*(assertion_ids(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(assertion_ids(item) for item in value))
    return set()


def rows(form: dict, name: str) -> range:
    """Return the row indexes a list in the form declares, at most MAX_ROWS."""
    try:
        return range(min(max(int(form.get(name, 0) or 0), 0), MAX_ROWS))
    except ValueError:
        raise HTTPException(400) from None


def edited(base: dict, form: dict, terms: list[dict]) -> dict:
    """Apply the workspace form to the body it was built on.

    A value the person changed carries an explicit empty evidence list: it is the
    moderator's, not the source's. Untouched values keep their evidence and component.
    """
    body = copy.deepcopy(base)
    evidence = body.setdefault('evidence', {})
    for field in SCALARS:
        value = form.get(field, '').strip()
        if field in CHOICES and value not in CHOICES[field]:
            value = body.get(field, '')
        if value == (body.get(field) or ''):
            continue
        if value:
            body[field] = value
        else:
            body.pop(field, None)
        evidence[field] = []
    if any(body.get(field) for field in TEXTS) and not body.get('original_language'):
        body['original_language'] = 'it'
        evidence['original_language'] = []

    contacts, known = [], {item.get('component_id'): item for item in base.get('contacts', [])}
    order = max([item.get('sort_order', 0) for item in known.values()], default=0)
    for index in rows(form, 'contacts'):
        key = f'contact_{index}_'
        value = form.get(key + 'value', '').strip()
        if form.get(key + 'remove') or not value:
            continue
        before = known.pop(form.get(key + 'component'), None)  # each component once
        item = copy.deepcopy(before) if before else {}
        changed = {'channel_type': form.get(key + 'channel') if form.get(key + 'channel') in CHANNELS else 'other',
                   'value': value, 'label': form.get(key + 'label', '').strip() or None,
                   'is_public': bool(form.get(key + 'public'))}
        if before is None or any(item.get(name, True if name == 'is_public' else None) != changed[name] for name in changed):
            if before is None or item.get('value') != value:
                item.pop('normalized_value', None)
            item.update({name: v for name, v in changed.items() if v is not None})
            if changed['label'] is None:
                item.pop('label', None)
            if before is None:
                order += 1
                item['sort_order'] = order
            item['evidence'] = []
        contacts.append(item)
    if 'contacts' in form:  # a form without the list leaves it as it was
        body['contacts'] = contacts

    conditions, known = [], {item.get('component_id'): item for item in base.get('conditions', [])}
    for index in rows(form, 'conditions'):
        key = f'condition_{index}_'
        kind, state = form.get(key + 'kind'), form.get(key + 'state')
        if form.get(key + 'remove') or kind not in CONDITION_KINDS or state not in REQUIREMENTS:
            continue
        before = known.pop(form.get(key + 'component'), None)
        item = copy.deepcopy(before) if before else {}
        changed = {'condition_kind': kind, 'requirement_state': state, 'details': form.get(key + 'details', '').strip() or None}
        if before is None or any(item.get(name) != value for name, value in changed.items()):
            item.update({name: value for name, value in changed.items() if value is not None})
            if changed['details'] is None:
                item.pop('details', None)
            item['evidence'] = []
        conditions.append(item)
    if 'conditions' in form:
        body['conditions'] = conditions

    if 'schedules' in form:
        body['schedules'], body['calendar_links'] = hours.edited_schedules(base, form, body.get('contacts', []))

    if 'needs' not in form:
        return body
    chosen = {(term['adoption_id'], term['term_id']) for term in terms if form.get(f"need_{term['adoption_id']}_{term['term_id']}")}
    kept = [item for item in base.get('classifications', []) if (item['adoption_id'], item['term_id']) in chosen
            or not any((item['adoption_id'], item['term_id']) == (t['adoption_id'], t['term_id']) for t in terms)]
    present = {(item['adoption_id'], item['term_id']) for item in kept}
    body['classifications'] = kept + [{'adoption_id': a, 'term_id': t, 'evidence': []} for a, t in sorted(chosen - present)]
    return body


class Workspace:
    """Read everything one service's workspace shows, as the verified person."""

    def __init__(self, module: Moderation, connection, service: str):
        """Keep the transaction and the service; read its heads."""
        self.module, self.connection, self.service = module, connection, service
        heads = connection.execute(HEADS, {'e': service}).fetchone()
        if not heads['service']:
            raise HTTPException(404)
        self.working, self.public = heads['working'], heads['public']
        self.locations = {}

    def body(self, revision: str | None) -> dict | None:
        """Return a revision's complete body, or None."""
        if revision is None:
            return None
        return self.connection.execute('SELECT editorial.revision_body(%s) AS body', (revision,)).fetchone()['body']

    def terms(self, body: dict) -> list[dict]:
        """Return the needs the service can be given where it is on the map."""
        return self.connection.execute(TERMS, (body.get('territories', []),)).fetchall()

    def location(self, location: str | None) -> dict | None:
        """Return a location's name, address and whether it is public, as the page shows it."""
        if not location:
            return None
        if location not in self.locations:
            found = self.connection.execute(LOCATION, {'l': location}).fetchone()['body'] or {}
            public = self.connection.execute('SELECT EXISTS(SELECT FROM governance.published_heads WHERE entity_id=%s) AS p',
                                             (location,)).fetchone()['p']
            self.locations[location] = {'location_id': location, 'name': found.get('name'), 'public': public,
                                        'address': next((a.get('formatted') for a in found.get('addresses', [])), None)}
        return self.locations[location]

    def context(self, form_body: dict | None = None, posted: dict | None = None, query: str = '') -> dict:
        """Collect the page: bodies, comparison, evidence, protections, place, hours, contributions."""
        public = self.body(self.public)
        draft = self.body(self.working) if self.working != self.public else None
        base = draft or public
        shown = form_body or base
        terms = self.terms(shown)
        names = {(t['adoption_id'], t['term_id']): t['name'] for t in terms}
        cited = assertion_ids(public) | assertion_ids(draft)
        assertions = self.connection.execute(EVIDENCE, (sorted(cited),)).fetchall() if cited else []
        by_id = {row['assertion_id']: row for row in assertions}
        records = {}
        for row in assertions:
            text = json.dumps(row['raw_payload'], ensure_ascii=False, indent=1)
            records.setdefault(row['record'], {'source': row['source'], 'text': text[:SOURCE_TEXT],
                                               'cut': len(text) > SOURCE_TEXT})
        place = self.location((shown.get('place') or {}).get('location_id'))
        if place is None and (shown.get('place') or {}).get('area_description'):
            place = {'name': shown['place']['area_description'], 'address': None, 'public': True}
        try:
            with self.connection.transaction():
                protections = self.connection.execute('SELECT governance.read_contact_protections(%s) AS p',
                                                      (self.service,)).fetchone()['p']
        except Exception:  # noqa: BLE001  a missing territorial grant only hides the summary
            protections = None
        contributions = [row for row in self.connection.execute('SELECT * FROM editorial.list_contributions(false)').fetchall()
                         if str(row['service_id']) == self.service]
        rows = [{'field': field, 'source': self.source(field, base or {}, by_id),
                 'public': self.show(field, public, names), 'draft': self.show(field, draft, names) if draft else None}
                for field in COMPARED]
        for row in rows:
            row['changed'] = draft is not None and row['public'] != row['draft']
        return {'service_id': self.service, 'working': self.working, 'public_revision': self.public,
                'public': public, 'draft': draft, 'shown': shown, 'terms': terms,
                'chosen': {(i['adoption_id'], i['term_id']) for i in shown.get('classifications', [])},
                'rows': rows, 'records': list(records.values()), 'protections': protections, 'place': place,
                'schedules': hours.form_rows(shown.get('schedules', [])), 'calendars': len(shown.get('calendar_links', [])),
                'saved_contacts': [c for c in shown.get('contacts', []) if c.get('component_id')],
                'contributions': contributions, 'posted': posted or {}, 'query': query,
                'found_locations': places.find_locations(self.connection, query), 'territories': places.territories(self.connection),
                'choices': CHOICES, 'channels': CHANNELS, 'condition_kinds': CONDITION_KINDS, 'requirements': REQUIREMENTS,
                'scopes': hours.SCOPES, 'day_states': hours.DAY_STATES, 'completeness': hours.COMPLETENESS,
                'kinds': places.KINDS, 'methods': places.METHODS}

    def show(self, field: str, body: dict | None, names: dict) -> str:
        """Write one field of a body as the comparison shows it."""
        if body is None:
            return '—'
        text = self.module.text
        if field in CHOICES:
            return text(f'moderation.workspace.values.{field}.{body[field]}') if body.get(field) else '—'
        if field in SCALARS:
            return body.get(field) or '—'
        if field == 'needs':
            return ', '.join(sorted(names.get((i['adoption_id'], i['term_id']), i['term_id']) for i in body.get('classifications', []))) or '—'
        if field == 'hours':
            labels = {c['component_id']: c['value'] for c in body.get('contacts', []) if c.get('component_id')}
            return hours.summary(body.get('schedules', []), text, labels)
        if field == 'place':
            place = body.get('place') or {}
            found = self.location(place.get('location_id'))
            if found is None:
                return place.get('area_description') or '—'
            return ' · '.join(part for part in (found['name'], found['address']) if part) or found['location_id']
        if field == 'contacts':
            return '; '.join(f"{c['channel_type']}: {c['value']}" + (f" ({c['label']})" if c.get('label') else '')
                             + ('' if c.get('is_public', True) else ' · ' + text('moderation.workspace.private'))
                             for c in body.get('contacts', [])) or '—'
        return '; '.join(f"{text('moderation.workspace.values.condition_kind.' + c['condition_kind'])}: "
                         f"{text('moderation.workspace.values.requirement_state.' + c['requirement_state'])}"
                         + (f" — {c['details']}" if c.get('details') else '') for c in body.get('conditions', [])) or '—'

    @staticmethod
    def source(field: str, body: dict, by_id: dict) -> str:
        """Write what the sources cited for one field say."""
        if field in SCALARS:
            cited = body.get('evidence', {}).get(field, [])
        elif field == 'hours':
            cited = [e for s in body.get('schedules', []) for e in s.get('evidence') or []]
        elif field == 'place':
            cited = (body.get('place') or {}).get('evidence') or []
        else:
            cited = [e for item in body.get({'needs': 'classifications'}.get(field, field), []) for e in item.get('evidence', [])]
        values = []
        for item in cited:
            row = by_id.get(item['assertion_id'])
            if row:
                value = json.dumps(row['normalized_value'], ensure_ascii=False)
                values.append(f"{row['source']}: {value}" + (' ✗' if item.get('role') == 'contradicting' else ''))
        return '; '.join(dict.fromkeys(values)) or '—'


def page(request: Request, module: Moderation, service: str, form_body: dict | None = None,
         posted: dict | None = None, status: int = 200, **extra):
    """Render the workspace as the verified person."""
    query = request.query_params.get('luogo', '')[:200]
    with module.desk.acting(module.session_hash(request)) as (connection, person):
        context = Workspace(module, connection, service).context(form_body, posted, query)
    if posted and 'working' in posted:  # keep the revisions the person's form was built on: a stale form stays stale
        context['working'], context['public_revision'] = posted.get('working') or None, posted.get('public') or None
    return module.render(request, 'workspace.html', person, status=status, **context, **extra)


@router.get('/servizi', response_class=HTMLResponse)
def services(request: Request, q: str = '', module: Moderation = Depends(moderation)):
    """Find a service by name, published or not."""
    with module.desk.acting(module.session_hash(request)) as (connection, person):
        found = connection.execute(SEARCH, (places.pattern(q),)).fetchall()
    return module.render(request, 'services.html', person, found=found, q=q)


@router.get('/servizio/{service}', response_class=HTMLResponse)
def workspace(request: Request, service: UUID, module: Moderation = Depends(moderation)):
    """Show the service's workspace."""
    return page(request, module, str(service))


@router.post('/servizio/{service}/bozza')
async def save_draft(request: Request, service: UUID, module: Moderation = Depends(moderation)):
    """Save the form as a new working draft of the revision it was built on."""
    form = await module.form(request)
    module.check_post(request, form)
    service, working, public = str(service), revision(form, 'working'), revision(form, 'public')
    body = None
    try:
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            space = Workspace(module, connection, service)
            base = space.body(working or public)
            if base is None:
                raise Refused('stale_base')
            terms = space.terms(base)
            body = edited(base, {key: value for key, value in form.items() if key != 'schedules'}, terms)  # shown if hours are refused
            body = edited(base, form, terms)
            if body == base:
                raise Refused('no_changes')
            connection.execute("SELECT governance.save_revision('service',%s,%s,%s,%s,%s)",
                               (service, working, public, json.dumps(body), module.text('moderation.workspace.draft_note')))
    except Refused as refusal:
        return page(request, module, service, form_body=body, posted=form, status=409 if refusal.code.startswith('stale') else 400,
                    error=workspace_error(refusal.code))
    return RedirectResponse(f'{PATH}/servizio/{service}#confronto', status_code=303)


@router.post('/servizio/{service}/luogo')
async def move(request: Request, service: UUID, module: Moderation = Depends(moderation)):
    """Point the service at another location, existing or new, as a new draft; nothing else moves."""
    form = await module.form(request)
    module.check_post(request, form)
    service, working, public = str(service), revision(form, 'working'), revision(form, 'public')
    try:
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            space = Workspace(module, connection, service)
            base = space.body(working or public)
            if base is None:
                raise Refused('stale_base')
            note = module.text('moderation.workspace.draft_note')
            if form.get('location') == 'new':
                location = places.create_location(connection, form, note)
            else:
                location = revision(form, 'location')
                if location is None:
                    raise Refused('location_not_found')
                places.heads(connection, location)
            body = places.placed(base, location, places.location_territories(connection, location))
            connection.execute("SELECT governance.save_revision('service',%s,%s,%s,%s,%s)",
                               (service, working, public, json.dumps(body), note))
    except Refused as refusal:
        return page(request, module, service, posted=form, status=409 if refusal.code.startswith('stale') else 400,
                    error=workspace_error(refusal.code))
    return RedirectResponse(f'{PATH}/servizio/{service}#confronto', status_code=303)


@router.get('/servizi/nuovo', response_class=HTMLResponse)
def new_service(request: Request, luogo: str = '', module: Moderation = Depends(moderation)):
    """Show the form that creates a service: its location first, then its name."""
    return new_page(request, module, luogo[:200])


def new_page(request: Request, module: Moderation, query: str, posted: dict | None = None, status: int = 200, **extra):
    """Render the new-service form as the verified person."""
    with module.desk.acting(module.session_hash(request)) as (connection, person):
        context = {'query': query, 'found_locations': places.find_locations(connection, query),
                   'territories': places.territories(connection), 'kinds': places.KINDS, 'methods': places.METHODS,
                   'modes': CHOICES['delivery_mode'], 'posted': posted or {}}
    return module.render(request, 'new_service.html', person, status=status, **context, **extra)


@router.post('/servizi/nuovo')
async def create_service(request: Request, module: Moderation = Depends(moderation)):
    """Create a service draft at a chosen or new location, citing what the person verified."""
    form = await module.form(request)
    module.check_post(request, form)
    name, mode, choice = form.get('name', '').strip(), form.get('delivery_mode', ''), form.get('location', '')
    try:
        if not name:
            raise Refused('name_required')
        if mode not in CHOICES['delivery_mode']:
            raise Refused('mode_required')
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            note = module.text('moderation.workspace.created_note')
            if choice == 'new':
                location = places.create_location(connection, form, note)
                where = places.location_territories(connection, location)
            elif choice == 'none':
                location, where = None, [places.chosen_territory(connection, form, '')]
            else:
                location = revision(form, 'location')
                if location is None:
                    raise Refused('location_required')
                where = places.location_territories(connection, location) or [places.chosen_territory(connection, form, '')]
            cited = places.observation(connection, 'service', {'name': name, 'delivery_mode': mode}, form)
            body = {'name': name, 'delivery_mode': mode, 'original_language': 'it', 'territories': where,
                    'evidence': {'record': cited['name'] + cited['delivery_mode'], 'name': cited['name'],
                                 'delivery_mode': cited['delivery_mode'], 'original_language': [], 'territories': []}}
            if location:
                body['place'] = {'location_id': location, 'evidence': []}
            made = connection.execute("SELECT governance.save_revision('service',NULL,NULL,NULL,%s,%s) AS r",
                                      (json.dumps(body), note)).fetchone()['r']
            service = connection.execute('SELECT entity_id::text FROM governance.entity_revisions WHERE revision_id=%s',
                                         (made,)).fetchone()['entity_id']
    except Refused as refusal:
        return new_page(request, module, form.get('query', '')[:200], posted=form, status=400, error=workspace_error(refusal.code))
    return RedirectResponse(f'{PATH}/servizio/{service}', status_code=303)


@router.post('/servizio/{service}/pubblica')
async def publish(request: Request, service: UUID, module: Moderation = Depends(moderation)):
    """Approve and publish exactly the draft the person compared, with their change summary."""
    form = await module.form(request)
    module.check_post(request, form)
    service, summary = str(service), form.get('summary', '').strip()
    draft, public = revision(form, 'working'), revision(form, 'public')
    try:
        if not summary:
            raise Refused('summary_required')
        if not draft:
            raise Refused('stale_base')
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            places.publish_new_location(connection, Workspace(module, connection, service).body(draft), summary)
            decision = connection.execute("SELECT governance.review_revision(%s,%s,'approved',%s) AS d",
                                          (draft, public, summary)).fetchone()['d']
            connection.execute('SELECT governance.publish_revision(%s,%s,%s)', (draft, decision, public))
    except Refused as refusal:
        return page(request, module, service, posted={'summary': summary}, status=409 if refusal.code.startswith('stale') else 400,
                    error=workspace_error(refusal.code), missing=missing(refusal.code))
    return RedirectResponse(f'{PATH}/servizio/{service}?pubblicato=1', status_code=303)


def revision(form: dict, name: str) -> str | None:
    """Return a revision identifier the form carried, or None; anything else is refused."""
    value = form.get(name) or None
    if value is not None:
        try:
            value = str(UUID(value))
        except ValueError:
            raise HTTPException(400) from None
    return value


EXPLAINED = ('no_changes', 'summary_required', 'publication_incomplete', 'session_invalid', 'invalid_hours', 'schedule_overlap',
             'schedule_contact', 'location_not_found', 'location_required', 'location_incomplete', 'territory_required',
             'method_required', 'note_too_long', 'invalid_point', 'name_required', 'mode_required')
MISSING = ('missing_name', 'missing_description', 'missing_channel', 'missing_place', 'missing_evidence', 'missing_area_description',
           'unpublished_location', 'unidentifiable_location', 'unpublished_organization', 'invalid_shared_contact')


def workspace_error(code: str) -> str:
    """Name a refusal with a catalog key; database details after ':' are not shown."""
    code = code.split(':')[0]
    if code in ('stale_base', 'stale_submission'):
        return 'stale'
    return code if code in EXPLAINED else 'refused'


def missing(code: str) -> list[str]:
    """Return what a refused publication lacks, as catalog keys the page explains."""
    if not code.startswith('publication_incomplete:'):
        return []
    return [item for item in code.split(':', 1)[1].strip().split(',') if item in MISSING]
