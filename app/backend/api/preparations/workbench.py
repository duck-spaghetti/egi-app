"""Expose bounded private plan reads and explicit, versioned workbench decisions.

Every operation uses the existing verified session, CSRF, no-store and thread-pool
boundary. SQL owns eligibility, manifests, coverage, billing and idempotent receipts.
"""
from uuid import UUID

from fastapi import APIRouter, Query, Request
from psycopg.types.json import Jsonb

from .http import Failure, PreparationRoute, execute, identifier, read_json, reply, revision

router = APIRouter(prefix='/moderazione/contribuisci/api/preparazioni', route_class=PreparationRoute)


def selected_items(value):
    """Normalize one explicit bounded selection without clipping or deduplicating it."""
    if not isinstance(value, list) or not 1 <= len(value) <= 100:
        raise Failure(422, 'invalid_workbench_selection')
    items = [identifier(item) for item in value]
    if len(set(items)) != len(items):
        raise Failure(422, 'invalid_workbench_selection')
    return items


def configuration_version(value):
    """Allow current server configuration resolution or an explicit frozen version."""
    if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= 200):
        raise Failure(422, 'invalid_request')
    return value


def analysis_tasks(value):
    """Accept only an explicit nonempty set of the two approved workbench tasks."""
    if not isinstance(value, list) or not 1 <= len(value) <= 2 or any(
            not isinstance(task, str) or task not in ('classify_cards', 'group_labels') for task in value):
        raise Failure(422, 'invalid_request')
    if len(set(value)) != len(value):
        raise Failure(422, 'invalid_request')
    return sorted(value)


def plan_version(value):
    """Require a positive exact plan version, excluding Boolean JSON values."""
    value = revision(value)
    if value < 1:
        raise Failure(422, 'invalid_request')
    return value


@router.post('/{workspace}/piani/anteprima')
async def preview(request: Request, workspace: UUID):
    """Freeze a visible selection and bounds without enqueueing or granting live access."""
    body = await read_json(request, ('item_ids', 'configuration_version', 'limits', 'request_key'), ('tasks',))
    if not isinstance(body['limits'], dict):
        raise Failure(422, 'invalid_plan_limits')
    return reply(await execute(request, 'SELECT preparation.preview_analysis_plan(%s,%s,%s,%s,%s,%s) AS result',
        (workspace, selected_items(body['item_ids']), configuration_version(body['configuration_version']),
         Jsonb(body['limits']), identifier(body['request_key']), analysis_tasks(body.get('tasks', ['classify_cards', 'group_labels']))), True), 201)


@router.get('/{workspace}/piani/{plan}')
async def read_plan(request: Request, workspace: UUID, plan: UUID,
                    version: int = Query(1, ge=1), offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    """Read one bounded manifest/job page with frozen context and event cursors."""
    return reply(await execute(request, 'SELECT preparation.read_analysis_plan(%s,%s,%s,%s,%s) AS result',
        (workspace, plan, version, offset, limit)))


@router.get('/{workspace}/piani/{plan}/copertura')
async def coverage(request: Request, workspace: UUID, plan: UUID,
                   version: int = Query(1, ge=1), offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    """Read unique record coverage separately from declared comparison progress."""
    return reply(await execute(request, 'SELECT preparation.read_analysis_coverage(%s,%s,%s,%s,%s) AS result',
        (workspace, plan, version, offset, limit)))


@router.get('/{workspace}/piani/{plan}/eventi')
async def events(request: Request, workspace: UUID, plan: UUID,
                 version: int = Query(1, ge=1), after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    """Read append-only safe progress events without an unbounded history response."""
    return reply(await execute(request, 'SELECT preparation.read_analysis_events(%s,%s,%s,%s,%s) AS result',
        (workspace, plan, version, after, limit)))


@router.get('/{workspace}/piani/{plan}/schede/{item}/risultati')
async def results(request: Request, workspace: UUID, plan: UUID, item: UUID,
                  version: int = Query(1, ge=1), offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    """Read only selected-record result links and closed proposals in bounded pages."""
    return reply(await execute(request, 'SELECT preparation.read_analysis_record_results(%s,%s,%s,%s,%s,%s) AS result',
        (workspace, plan, version, item, offset, limit)))


@router.post('/{workspace}/piani/{plan}/avvia')
async def start(request: Request, workspace: UUID, plan: UUID):
    """Deliberately start exactly the reviewed plan version and its declared envelope."""
    body = await read_json(request, ('version', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.start_analysis_plan(%s,%s,%s,%s) AS result',
        (workspace, plan, plan_version(body['version']), identifier(body['request_key'])), True), 202)


@router.post('/{workspace}/piani/{plan}/continua')
async def continue_plan(request: Request, workspace: UUID, plan: UUID):
    """Request only unresolved declared work within the frozen remaining limits."""
    body = await read_json(request, ('version', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.continue_analysis_plan(%s,%s,%s,%s) AS result',
        (workspace, plan, plan_version(body['version']), identifier(body['request_key'])), True), 202)


@router.post('/{workspace}/piani/{plan}/annulla')
async def cancel(request: Request, workspace: UUID, plan: UUID):
    """Revoke result use while keeping already-dispatched usage accountable."""
    body = await read_json(request, ('version', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.cancel_analysis_plan(%s,%s,%s,%s) AS result',
        (workspace, plan, plan_version(body['version']), identifier(body['request_key'])), True))


@router.post('/{workspace}/piani/{plan}/modifica')
async def amend(request: Request, workspace: UUID, plan: UUID):
    """Preview a new visible plan identity, preserving the prior plan and reviewed cards."""
    body = await read_json(request, ('version', 'item_ids', 'configuration_version', 'limits', 'request_key'), ('tasks',))
    if not isinstance(body['limits'], dict):
        raise Failure(422, 'invalid_plan_limits')
    return reply(await execute(request, 'SELECT preparation.amend_analysis_plan(%s,%s,%s,%s,%s,%s,%s,%s) AS result',
        (workspace, plan, plan_version(body['version']), selected_items(body['item_ids']),
         configuration_version(body['configuration_version']), Jsonb(body['limits']), identifier(body['request_key']), analysis_tasks(body.get('tasks', ['classify_cards', 'group_labels']))), True), 201)


@router.post('/{workspace}/pacchetti/{packet}/ripeti')
async def retry_uncertain(request: Request, workspace: UUID, packet: UUID):
    """Authorize one new paid attempt without releasing the old uncertain reservation."""
    body = await read_json(request, ('request_key',))
    return reply(await execute(request, 'SELECT preparation.retry_uncertain_analysis_packet(%s,%s,%s) AS result',
        (workspace, packet, identifier(body['request_key'])), True), 202)
