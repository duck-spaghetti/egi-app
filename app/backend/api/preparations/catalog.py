"""Authorize bounded catalog reads and local suggestions without IA or writes.

Private reads use workspace ACLs. Editorial reads require a submitted snapshot and
never expose private originals or unsent cards. PostgreSQL revalidates any choice.
"""
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from .http import Failure, PreparationRoute, execute, identifier, read_json, reply

router = APIRouter(prefix='/moderazione', route_class=PreparationRoute)


async def read_catalog(request, identity, query, *, editorial=False):
    """Read one authorized page with the same DB date used by adoption checks."""
    if not isinstance(query, dict):
        raise Failure(422, 'invalid_catalog_query')
    sql = ("SELECT editorial.reference_catalog(%s,%s)||jsonb_build_object('as_of',current_date::text) AS result" if editorial else
           "SELECT preparation.reference_catalog(%s,%s)||jsonb_build_object('as_of',current_date::text) AS result")
    return await execute(request, sql, (identity, Jsonb(query)))


@router.post('/contribuisci/api/preparazioni/{workspace}/catalogo')
async def private_catalog(request: Request, workspace: UUID):
    """Search authorized names/contexts without putting private queries in URLs."""
    body = await read_json(request, ('query',))
    return reply(await read_catalog(request, workspace, body['query']))


@router.post('/contributo/{contribution}/catalogo')
async def editorial_catalog(request: Request, contribution: UUID):
    """Search canonical references for one selective submitted proposal."""
    body = await read_json(request, ('query',))
    return reply(await read_catalog(request, contribution, body['query'], editorial=True))


async def suggest(request, identity, payload, fact_id, query, *, editorial=False):
    """Compare one current literal with at most100 local catalog entries, never IA."""
    fact = next((item for item in payload.get('source_facts', []) if item['fact_id'] == str(fact_id)), None)
    if fact is None or not fact.get('value') or not isinstance(query, dict):
        raise Failure(422, 'invalid_fact_action')
    wanted = 'organization' if fact['kind'] == 'organization_name' else 'classification'
    if query.get('kind') != wanted or fact['subject'] == 'location' and wanted == 'classification':
        raise Failure(422, 'invalid_reference_context')
    query = {**query, 'limit': 50, 'offset': 0, 'search': ''}
    page = await read_catalog(request, identity, query, editorial=editorial)
    if page['next_offset'] is not None:
        next_page = await read_catalog(request, identity, {**query, 'offset': page['next_offset']}, editorial=editorial)
        page['entries'] += next_page['entries']
        page['complete'] = next_page['complete']
    try:
        from review.insertion_fields import ContractError
        from review.matching import make_context, propose, resolve_matches
    except ImportError:
        raise Failure(503, 'catalog_matching_unavailable') from None
    local = {'fact_key': fact['fact_id'], 'kind': fact['kind'], 'subject': fact['subject'], 'source_value': fact['value']}
    def compare():
        """Run bounded lexical CPU work away from the shared web event loop."""
        try:
            context = make_context(page, as_of=date.fromisoformat(page['as_of']))
            # Long free-form passages remain editable, with manual search available;
            # they are not silently truncated into a misleading category query.
            matches = propose([local], context) if len(fact['value']) <= 500 else [
                {'fact_key': fact['fact_id'], 'context_digest': context['digest'], 'choices': []}]
            resolutions = resolve_matches(matches, [local], context)
        except ContractError:
            raise Failure(422, 'invalid_reference_context') from None
        return {'fact_id': fact['fact_id'], 'fact_value': fact['value'], 'resolution': {k: v for k, v in resolutions[0].items() if k != 'fact_key'},
                'complete': context['complete'], 'candidate_count': len(context['entries']),
                'context_digest': context['digest'], 'long_value': len(fact['value']) > 500}
    return await run_in_threadpool(compare)


@router.post('/contribuisci/api/preparazioni/{workspace}/schede/{item}/suggerimenti')
async def private_suggestions(request: Request, workspace: UUID, item: UUID):
    """Bind one read-only local proposal to an actual private item version/value."""
    body = await read_json(request, ('expected_version', 'fact_id', 'query'))
    current = await execute(request, 'SELECT preparation.read_item(%s,%s,NULL) AS result', (workspace, item))
    version = identifier(body['expected_version'])
    if str(version) != str(current['version']['id']):
        raise Failure(409, 'item_version_conflict')
    result = await suggest(request, workspace, current['version']['payload'], identifier(body['fact_id']), body['query'])
    return reply({**result, 'item_version': str(version)})


@router.post('/contributo/{contribution}/suggerimenti')
async def editorial_suggestions(request: Request, contribution: UUID):
    """Suggest against the submitted literal; moderation carries no private ACL grant."""
    body = await read_json(request, ('fact_id', 'query'))
    copied = await execute(request, 'SELECT editorial.read_community_snapshot(%s) AS result', (contribution,))
    result = await suggest(request, contribution, copied['snapshot']['values'], identifier(body['fact_id']), body['query'], editorial=True)
    return reply({**result, 'item_version': str(copied['snapshot']['item_version_id'])})
