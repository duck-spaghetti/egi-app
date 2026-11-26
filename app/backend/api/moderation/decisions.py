"""Decide visitor proposals into drafts, close contributions and release protections.

Decisions and their draft write share one session-verified transaction. Structured
facts are entered by the moderator, never guessed from visitor prose. The existing
canonical operations retain revision checks, evidence and publication authority.
"""
import copy
import json
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import hours, places
from .desk import Refused
from .queue import contribution_page
from .service import PATH, Moderation
from .workspace import CHANNELS, CONDITION_KINDS, REQUIREMENTS, Workspace, moderation, page, revision

router = APIRouter()
TARGETS = ('name', 'description', 'contacts', 'hours', 'conditions', 'closed', 'cost_note', 'address')
ALIASES = {'offer': 'description', 'condition': 'conditions', 'access': 'conditions', 'link': 'contacts'}
OUTCOMES = ('published', 'no_change', 'rejected', 'duplicate')
PUBLICATIONS = '''SELECT p.publication_id::text,h.entity_id::text AS service_id,n.original_text AS name
 FROM governance.published_heads h JOIN governance.publications p USING(publication_id)
 JOIN data.service_revisions s ON s.revision_id=h.revision_id
 LEFT JOIN i18n.content_units n ON n.content_id=s.name_content_id
 WHERE (%s::uuid IS NULL OR h.entity_id=%s::uuid) AND COALESCE(n.original_text,'') ILIKE %s ESCAPE '\\'
 ORDER BY n.original_text,h.entity_id LIMIT 50'''


def read_open(connection, contribution: str) -> dict:
    """Serialize this app's decisions and return an open contribution, never a closed one."""
    connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', ('egi:contribution:' + contribution,))
    item = connection.execute('SELECT editorial.read_contribution(%s) AS item', (contribution,)).fetchone()['item']
    if item['state'] == 'closed':
        raise Refused('contribution_closed')
    return item


def context(connection, item: dict, query: str = '') -> dict:
    """Provide typed proposal controls and only relevant public closure choices."""
    body, working, public = {}, None, None
    if item['service_id']:
        space = Workspace(None, connection, item['service_id'])
        working, public = space.working, space.public
        body = space.body(working or public) or {}
    decorate(item)
    publications = connection.execute(PUBLICATIONS, (item['service_id'], item['service_id'], places.pattern(query))).fetchall()
    return {'review_body': body, 'working': working, 'public_revision': public,
            'methods': places.METHODS, 'review_targets': TARGETS, 'outcomes': OUTCOMES,
            'publications': publications, 'publication_query': query, 'channels': CHANNELS,
            'condition_kinds': CONDITION_KINDS, 'requirements': REQUIREMENTS, 'day_states': hours.DAY_STATES}


def decorate(item: dict) -> dict:
    """Give each proposal its editable field using the same mapping in queue and workspace."""
    for proposal in item['proposals']:
        proposal['target'] = ALIASES.get(proposal['field'], proposal['field'])
    return item


def changed_component(body: dict, field: str, wanted: str | None) -> dict:
    """Return a selected existing component or append a new one; reject foreign IDs."""
    items = body.setdefault(field, [])
    if wanted:
        found = next((item for item in items if item.get('component_id') == wanted), None)
        if found is None:
            raise Refused('proposal_invalid')
        return found
    item = {}
    items.append(item)
    return item


def apply(connection, base: dict, proposal: dict, form: dict) -> tuple[dict, object]:
    """Apply one explicitly verified proposal, preserving all unrelated aggregate parts."""
    body = copy.deepcopy(base)
    target = ALIASES.get(proposal['field'], proposal['field'])
    if target not in TARGETS:
        target = form.get('target')
    if target not in TARGETS:
        raise Refused('proposal_invalid')
    value = proposal['value'] if form['decision'] == 'accepted' else form.get('value', '').strip()
    if not isinstance(value, str) or not value.strip():
        raise Refused('proposal_invalid')
    value = value.strip()
    normalized = value
    if target == 'address':
        if form.get('location'):
            location = revision(form, 'location')
            places.heads(connection, location)
        else:
            location_form = {**form, 'location_street': form.get('location_street') or value}
            location = places.create_location(connection, location_form, 'Contribution address checked')
        body = places.placed(body, location, places.location_territories(connection, location))
        normalized = {'location_id': location}
    else:
        if target == 'contacts':
            channel = form.get('channel')
            if channel not in ('phone', 'email', 'web', 'whatsapp', 'other'):
                raise Refused('proposal_invalid')
            contact = changed_component(body, 'contacts', form.get('component'))
            contact.update(channel_type=channel, value=value, is_public=bool(form.get('public_contact')))
            contact.pop('normalized_value', None)
            observed = {'contact': {'channel_type': channel, 'value': value}}
        elif target == 'conditions':
            kind, state = form.get('condition_kind'), form.get('requirement_state')
            if kind not in ('appointment', 'referral', 'document', 'eligibility', 'other') or state not in (
                    'required', 'not_required', 'conditional', 'unknown'):
                raise Refused('proposal_invalid')
            contact = changed_component(body, 'conditions', form.get('component'))
            contact.update(condition_kind=kind, requirement_state=state, details=value)
            observed = {'access_condition': {'condition_kind': kind, 'requirement_state': state, 'details': value}}
        elif target == 'hours':
            observed = {'hours': hours.correct_day(body, form)}
        else:
            field = 'operational_status' if target == 'closed' else target
            if target == 'closed':
                value = form.get('operational_status', '')
                if value not in ('active', 'temporarily_closed', 'defunct', 'inactive', 'unknown'):
                    raise Refused('proposal_invalid')
            body[field] = value
            observed = {field: value}
        cited = places.observation(connection, 'service', observed, form)
        if target in ('contacts', 'conditions'):
            contact['evidence'] = next(iter(cited.values()))
            normalized = {key: v for key, v in contact.items() if key not in ('evidence', 'component_id')}
        elif target == 'hours':
            schedule = body['schedules'][observed['hours']['index']]
            schedule['evidence'] = schedule.get('evidence', []) + cited['hours']
            for day in schedule['days']:
                if day['weekday'] == observed['hours']['weekday']:
                    for interval in day['intervals']:
                        if not interval.get('evidence'):
                            interval['evidence'] = cited['hours']
            normalized = observed['hours']
        else:
            body.setdefault('evidence', {})[field] = cited[field]
            normalized = value
    if not body.get('original_language'):
        body['original_language'] = 'it'
        body.setdefault('evidence', {})['original_language'] = []
    return body, normalized


@router.post('/contributo/{contribution}/proposta/{proposal}')
async def decide(request: Request, contribution: UUID, proposal: UUID, module: Moderation = Depends(moderation)):
    """Atomically record one decision and its accepted/amended values in a draft."""
    form = await module.form(request)
    module.check_post(request, form)
    contribution, proposal = str(contribution), str(proposal)
    try:
        decision = form.get('decision')
        if decision not in ('accepted', 'amended', 'rejected'):
            raise Refused('proposal_invalid')
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            item = read_open(connection, contribution)
            chosen = next((p for p in item['proposals'] if p['proposal_id'] == proposal), None)
            if chosen is None:
                raise HTTPException(404)
            if chosen['decision'] is not None:
                raise Refused('stale_submission')
            normalized = None
            if decision != 'rejected':
                if not item['service_id']:
                    raise Refused('proposal_new_service')
                working, public = revision(form, 'working'), revision(form, 'public')
                space = Workspace(module, connection, item['service_id'])
                if (working, public) != (space.working, space.public):
                    raise Refused('stale_base')
                base = space.body(working or public)
                body, normalized = apply(connection, base, chosen, form)
                connection.execute("SELECT governance.save_revision('service',%s,%s,%s,%s,%s)",
                                   (item['service_id'], working, public, json.dumps(body), module.text('moderation.review.draft_note')))
            connection.execute('SELECT editorial.decide_proposal(%s,%s,%s,%s)',
                               (proposal, decision, json.dumps(normalized) if decision == 'amended' else None, form.get('note') or None))
    except Refused as refusal:
        return contribution_page(request, module, contribution, error='review_refused', review_error=refusal.code,
                                 review_posted=form, review_proposal=proposal, status=409)
    return RedirectResponse(f'{PATH}/contributo/{contribution}', status_code=303)


@router.post('/contributo/{contribution}/chiudi')
async def close(request: Request, contribution: UUID, module: Moderation = Depends(moderation)):
    """Close with a reason or an explicitly chosen publication; visitor privacy deadlines remain in SQL."""
    form = await module.form(request)
    module.check_post(request, form)
    contribution = str(contribution)
    try:
        with module.desk.acting(module.session_hash(request)) as (connection, _):
            item = read_open(connection, contribution)
            if form.get('outcome') not in OUTCOMES:
                raise Refused('proposal_invalid')
            publication = revision(form, 'publication')
            if form['outcome'] == 'published' and publication:
                selected = connection.execute('SELECT published_at FROM governance.publications WHERE publication_id=%s',
                                              (publication,)).fetchone()
                accepted = [datetime.fromisoformat(p['decided_at']) for p in item['proposals']
                            if p['decision'] in ('accepted', 'amended')]
                if selected is None or any(at > selected['published_at'] for at in accepted):
                    raise Refused('publication_required')
            connection.execute('SELECT editorial.close_contribution(%s,%s,%s,%s)',
                               (contribution, form['outcome'], form.get('reason') or None, publication))
    except Refused as refusal:
        return contribution_page(request, module, contribution, error='review_refused', review_error=refusal.code, status=400)
    return RedirectResponse(f'{PATH}/contributo/{contribution}', status_code=303)


@router.post('/servizio/{service}/protezione')
async def release(request: Request, service: UUID, module: Moderation = Depends(moderation)):
    """Admin explicitly reviews/publishes a revision while releasing one selected protection."""
    form = await module.form(request)
    module.check_post(request, form)
    service = str(service)
    try:
        draft, public = revision(form, 'working'), revision(form, 'public')
        protection = revision(form, 'protection')
        note = form.get('reason', '').strip()
        if not draft or not protection or not note or form.get('scope') not in ('global', 'service'):
            raise Refused('proposal_invalid')
        with module.desk.acting(module.session_hash(request)) as (connection, person):
            if person['role'] != 'admin':
                raise HTTPException(403)
            space = Workspace(module, connection, service)
            if (draft, public) != (space.working, space.public):
                raise Refused('stale_base')
            decision = connection.execute("SELECT governance.review_revision(%s,%s,'approved',%s) AS id",
                                          (draft, public, note)).fetchone()['id']
            connection.execute('SELECT governance.publish_contact_protection_resolution(%s,%s,%s,%s,%s,%s)',
                               (draft, decision, public, [protection], service if form['scope'] == 'service' else None, note))
    except Refused:
        return page(request, module, service, error='review_refused', status=409)
    return RedirectResponse(f'{PATH}/servizio/{service}?pubblicato=1', status_code=303)
