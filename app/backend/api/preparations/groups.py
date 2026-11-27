"""Bounded private group operations and source-owned manual grouping projections.

Fixed SQL functions own version/ACL/apply/undo rules. Basis summaries use only
authorized read_item projections; local variants reuse the pinned Reviewer spelling
normalizer and require neither IA configuration nor a provider exchange.
"""
from collections import defaultdict
import hashlib
import json
from uuid import UUID

from fastapi import APIRouter, Query, Request
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from ..moderation.router import moderation
from .http import Failure, PreparationRoute, execute, identifier, read_json, reply, session
from .workbench import selected_items

router = APIRouter(prefix='/moderazione/contribuisci/api/preparazioni', route_class=PreparationRoute)
PROJECTION = """WITH owned AS MATERIALIZED (SELECT preparation.read_item(%s,%s,%s) AS body)
 SELECT jsonb_build_object('item_id',body->'item_id','version',body#>'{version,id}',
 'name',body#>'{version,payload,service,name}',
 'payload',jsonb_build_object('service',jsonb_build_object('name',body#>'{version,payload,service,name}','description',body#>'{version,payload,service,description}'),
 'source_facts',COALESCE(body#>'{version,payload,source_facts}','[]'),
 'interpreted_classifications',COALESCE(body#>'{version,payload,interpreted_classifications}','[]'),
 'evidence',COALESCE(body#>'{version,payload,evidence}','[]'))) AS result
 FROM owned"""


def page(value, maximum=200000, minimum=0):
    """Validate explicit bounded JSON paging values without Boolean aliases."""
    if type(value) is not int or not minimum <= value <= maximum:
        raise Failure(422, 'invalid_request')
    return value


def field_value(payload, path):
    """Resolve only the retained safe name/description/source-fact projection."""
    try:
        value = payload
        for key in path.lstrip('/').split('/'):
            key = key.replace('~1', '/').replace('~0', '~')
            value = value[int(key)] if isinstance(value, list) else value[key]
        return value if isinstance(value, str) else None
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def read_owned(connection, workspace, item, version=None):
    """Read an owned safe projection in the already verified transaction."""
    return connection.execute(PROJECTION, (workspace, UUID(str(item)), UUID(str(version)) if version else None)).fetchone()['result']


def fact_row(member, current, index, fact):
    """Project one original category fact without any unrelated private fields."""
    path = '/source_facts/' + str(index) + '/source_value'
    return {'member': member, 'name': current['name'], 'label': fact['source_value'], 'value': fact.get('value'), 'origin': 'source_fact',
        'state': 'corrected' if fact.get('value') != fact['source_value'] else 'original', 'context': None,
        'original': {'value': fact['source_value'], 'path': path, 'evidence': [e for e in current['payload']['evidence'] if e.get('path') == path]}}


def basis_rows(connection, workspace, item_ids):
    """Index selected current category facts and materialized interpretations only."""
    rows = []
    for item in item_ids:
        current = read_owned(connection, workspace, item)
        payload = current['payload']
        for index, fact in enumerate(payload['source_facts']):
            if fact.get('kind') != 'category_label' or fact.get('subject') != 'service':
                continue
            member = {'item_id': str(item), 'expected_version': current['version'], 'basis_kind': 'source_fact', 'basis_id': fact['fact_id']}
            rows.append(fact_row(member, current, index, fact))
        for record in payload['interpreted_classifications']:
            rows.append({'member': {'item_id': str(item), 'expected_version': current['version'], 'basis_kind': 'interpreted_classification', 'basis_id': record['interpretation_id']},
                'name': current['name'], 'label': None, 'value': None, 'origin': 'interpreted_classification', 'state': record['state'], 'context': record['context'],
                'basis': record['basis'], 'original': None})
    return rows


def enrich_rows(connection, workspace, rows):
    """Attach original historical interpretation support only to the requested page."""
    cache = {}
    for row in rows:
        basis = row.pop('basis', None)
        if basis is None:
            continue
        key = (row['member']['item_id'], basis['item_version'])
        if key not in cache:
            cache[key] = read_owned(connection, workspace, key[0], key[1])
        payload = cache[key]['payload']
        value = field_value(payload, basis['field_path'])
        row['label'] = row['value'] = value
        row['original'] = {'value': value, 'path': basis['field_path'],
            'evidence': [e for e in payload['evidence'] if e.get('id') in basis['evidence_ids'] and e.get('path') == basis['field_path']]} if value is not None else None
    return rows


def member_details(connection, workspace, members):
    """Resolve a bounded exact member page through owned historical versions."""
    if not isinstance(members, list) or len(members) > 100:
        raise Failure(422, 'invalid_request')
    details, cache = [], {}
    for member in members:
        key = (member['item_id'], member['expected_version'])
        if key not in cache:
            cache[key] = read_owned(connection, workspace, *key)
        current = cache[key]
        payload = current['payload']
        if member['basis_kind'] == 'source_fact':
            index, fact = next((index, fact) for index, fact in enumerate(payload['source_facts']) if fact['fact_id'] == member['basis_id'])
            details.append(fact_row(member, current, index, fact))
        else:
            record = next(record for record in payload['interpreted_classifications'] if record['interpretation_id'] == member['basis_id'])
            details.append({'member': member, 'name': current['name'], 'label': None, 'value': None, 'origin': 'interpreted_classification',
                'state': record['state'], 'context': record['context'], 'basis': record['basis'], 'original': None})
    return enrich_rows(connection, workspace, details)


async def private_read(request, operation, mutation=False):
    """Verify the current person and execute all fixed reads together off-thread."""
    digest = session(request, mutation)
    desk = moderation(request).desk

    def run():
        """Keep authorization and every owned projection in one transaction."""
        with desk.acting(digest) as (connection, _):
            return operation(connection)
    return await run_in_threadpool(run)


async def operation_receipt(request, workspace, sql, params, mutation=False):
    """Attach only owned frozen card names to a bounded operation receipt page."""
    def read(connection):
        """Keep operation, fresh ACL and exact-version name reads in one transaction."""
        result = connection.execute(sql, params).fetchone()['result']
        for item in result['items']:
            item['name'] = read_owned(connection, workspace, item['item_id'], item['after_version'] or item['before_version'])['name']
        return result
    return await private_read(request, read, mutation)


@router.post('/{workspace}/gruppi/contesto')
async def context(request: Request, workspace: UUID):
    """Resolve a current adopted context without any IA configuration or grant."""
    body = await read_json(request, ('territory_id', 'axis_id'))
    return reply(await execute(request, 'SELECT preparation.get_group_context(%s,%s,%s) AS result',
        (workspace, identifier(body['territory_id']), identifier(body['axis_id'])), True))


@router.post('/{workspace}/gruppi/basi')
async def bases(request: Request, workspace: UUID):
    """Return an explicit safe basis page for at most100 selected owned cards."""
    body = await read_json(request, ('item_ids',), ('offset', 'limit'))
    items, offset, limit = selected_items(body['item_ids']), page(body.get('offset', 0)), page(body.get('limit', 50), 100, 1)

    def read(connection):
        """Count all selected bases, then enrich only the returned page."""
        rows = basis_rows(connection, workspace, items)
        return {'bases': enrich_rows(connection, workspace, rows[offset:offset + limit]), 'total': len(rows),
            'next_offset': offset + limit if offset + limit < len(rows) else None, 'selected_items': len(items)}
    return reply(await private_read(request, read, True))


@router.post('/{workspace}/gruppi/varianti')
async def variants(request: Request, workspace: UUID):
    """Return paged literal spelling variants; no semantic mapping is inferred."""
    body = await read_json(request, ('item_ids', 'territory_id', 'axis_id'), ('offset', 'limit', 'member_offset', 'member_limit'))
    items, offset, limit = selected_items(body['item_ids']), page(body.get('offset', 0)), page(body.get('limit', 25), 100, 1)
    member_offset, member_limit = page(body.get('member_offset', 0)), page(body.get('member_limit', 50), 100, 1)
    territory, axis = identifier(body['territory_id']), identifier(body['axis_id'])

    def read(connection):
        """Use the pinned shared normalizer and actual current owned fact identities."""
        try:
            from review.workbench import normalize_label
        except ImportError:
            raise Failure(503, 'reviewer_unavailable') from None
        scope = connection.execute('SELECT preparation.get_group_context(%s,%s,%s) AS result', (workspace, territory, axis)).fetchone()['result']
        rows = basis_rows(connection, workspace, items)
        buckets = defaultdict(list)
        for row in rows:
            if row['origin'] == 'source_fact' and isinstance(row['label'], str) and row['label'].strip():
                buckets[normalize_label(row['label'])].append(row)
        groups = [(label, members) for label, members in sorted(buckets.items()) if len(members) >= 2]
        result = []
        for label, members in groups[offset:offset + limit]:
            members.sort(key=lambda row: (row['member']['item_id'], row['member']['basis_id']))
            identity = hashlib.sha256(json.dumps({'context': scope, 'label': label, 'members': [row['member'] for row in members]}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            selected = members[member_offset:member_offset + member_limit]
            result.append({'variant_key': identity, 'label': members[0]['label'], 'context': scope, 'method': 'deterministic',
                'members': [row['member'] for row in selected], 'details': selected, 'total_members': len(members),
                'next_member_offset': member_offset + member_limit if member_offset + member_limit < len(members) else None})
        return {'groups': result, 'total': len(groups), 'next_offset': offset + limit if offset + limit < len(groups) else None,
            'selected_items': len(items), 'total_bases': len(rows), 'literal_bases': sum(row['origin'] == 'source_fact' for row in rows),
            'interpreted_bases': sum(row['origin'] == 'interpreted_classification' for row in rows), 'scope': 'literal_spelling_only', 'context': scope}
    return reply(await private_read(request, read, True))


@router.get('/{workspace}/gruppi')
async def groups(request: Request, workspace: UUID, offset: int = Query(0, ge=0, le=100000), limit: int = Query(50, ge=1, le=100)):
    """Read one bounded group summary page without member or private input expansion."""
    return reply(await execute(request, 'SELECT preparation.list_groups(%s,%s,%s) AS result', (workspace, offset, limit)))


@router.post('/{workspace}/gruppi')
async def save(request: Request, workspace: UUID):
    """Save exactly one explicit versioned group revision through the DB contract."""
    body = await read_json(request, ('expected_version', 'revision', 'request_key'))
    if not isinstance(body['revision'], dict):
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT preparation.save_group(%s,%s,%s,%s) AS result',
        (workspace, identifier(body['expected_version'], True), Jsonb(body['revision']), identifier(body['request_key'])), True), 201)


@router.get('/{workspace}/gruppi/operazioni')
async def operations(request: Request, workspace: UUID, offset: int = Query(0, ge=0, le=100000), limit: int = Query(50, ge=1, le=100)):
    """Restore only the current editor's bounded durable group operation summaries."""
    return reply(await execute(request, 'SELECT preparation.list_group_operations(%s,%s,%s) AS result', (workspace, offset, limit)))


@router.get('/{workspace}/gruppi/operazioni/{operation}')
async def receipt(request: Request, workspace: UUID, operation: UUID, offset: int = Query(0, ge=0, le=100000), limit: int = Query(100, ge=1, le=100)):
    """Read durable per-card applied/skipped/conflict/pending outcomes."""
    return reply(await operation_receipt(request, workspace, 'SELECT preparation.read_group_operation(%s,%s,%s,%s) AS result', (workspace, operation, offset, limit)))


@router.post('/{workspace}/gruppi/operazioni/{operation}/annulla')
async def undo(request: Request, workspace: UUID, operation: UUID):
    """Compensate only unchanged produced heads, with the same resumable request key."""
    body = await read_json(request, ('request_key',))
    return reply(await operation_receipt(request, workspace, 'SELECT preparation.undo_group(%s,%s,%s) AS result', (workspace, operation, identifier(body['request_key'])), True))


@router.get('/{workspace}/gruppi/{group}')
async def group(request: Request, workspace: UUID, group: UUID, version: UUID | None = None,
                offset: int = Query(0, ge=0, le=100000), limit: int = Query(100, ge=1, le=100)):
    """Read bounded frozen members and safe original/interpretive basis labels."""
    def read(connection):
        """Resolve each paged member through its exact owned historical item version."""
        result = connection.execute('SELECT preparation.read_group(%s,%s,%s,%s,%s) AS result', (workspace, group, version, offset, limit)).fetchone()['result']
        result['details'] = member_details(connection, workspace, result['members'])
        return result
    return reply(await private_read(request, read))


@router.post('/{workspace}/gruppi/{group}/applica')
async def apply(request: Request, workspace: UUID, group: UUID):
    """Freeze at most100 explicitly selected exact members and process one bounded slice."""
    body = await read_json(request, ('expected_group_version', 'selection', 'request_key'))
    if not isinstance(body['selection'], list) or not 1 <= len(body['selection']) <= 100:
        raise Failure(422, 'invalid_workbench_selection')
    value = {**body, 'group_id': str(group), 'expected_group_version': str(identifier(body['expected_group_version'])), 'request_key': str(identifier(body['request_key']))}
    return reply(await operation_receipt(request, workspace, 'SELECT preparation.apply_group(%s,%s) AS result', (workspace, Jsonb(value)), True))
