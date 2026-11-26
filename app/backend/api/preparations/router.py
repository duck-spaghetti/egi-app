"""Expose private preparation reads, versioned edits and recoverable history.

Each handler selects one fixed database contract. PostgreSQL rechecks the verified
person's access on every operation, including idempotent receipt reads. No generic
SQL/function-name endpoint or original-input access through editorial IDs exists.
"""
import base64
from uuid import UUID

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response
from psycopg.types.json import Jsonb

from .http import Failure, PreparationRoute, execute, identifier, read_json, read_text, reply, revision

router = APIRouter(prefix='/moderazione/contribuisci/api', route_class=PreparationRoute)


@router.get('/persone')
async def people(request: Request):
    """List only active moderators already exposed by the editorial people contract."""
    return reply(await execute(request, 'SELECT COALESCE(jsonb_agg(to_jsonb(p)),\'[]\') AS result FROM editorial.list_moderators() p'))


@router.get('/preparazioni')
async def workspaces(request: Request, cestino: bool = False, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
    """List only owned or explicitly shared preparations with bounded pagination."""
    value = await execute(request, 'SELECT preparation.list_workspaces(%s) AS result', (cestino,))
    return reply({'items': value[offset:offset + limit], 'offset': offset, 'total': len(value)})


@router.post('/preparazioni')
async def create_workspace(request: Request):
    """Create a private preparation with a selected source and replay key."""
    body = await read_json(request, ('source_id', 'title', 'request_key'))
    if not isinstance(body['title'], str):
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT preparation.create_workspace(%s,%s,%s) AS result',
        (identifier(body['source_id']), body['title'], identifier(body['request_key'])), True), 201)


@router.get('/preparazioni/{workspace}')
async def workspace(request: Request, workspace: UUID, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
    """Read metadata, permission and a page of item summaries without full payloads."""
    value = await execute(request, 'SELECT preparation.read_workspace(%s) AS result', (workspace,))
    if value.get('current_input_id'):
        value['input_metadata'] = await execute(request, "SELECT preparation.read_input(%s,%s)-'original_base64' AS result", (workspace, value['current_input_id']))
    items = value['items']
    value['items'] = [{k: v for k, v in item.items() if k != 'payload'} for item in items[offset:offset + limit]]
    value.update(offset=offset, total=len(items))
    return reply(value)


@router.post('/preparazioni/{workspace}/accessi')
async def share(request: Request, workspace: UUID):
    """Let only the owner grant, change or revoke named read/edit access."""
    body = await read_json(request, ('actor_id', 'permission', 'expected_revision', 'request_key'))
    if body['permission'] not in ('read', 'edit', None):
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT preparation.set_grant(%s,%s,%s,%s,%s) AS result',
        (workspace, identifier(body['actor_id']), body['permission'], revision(body['expected_revision']), identifier(body['request_key'])), True))


@router.post('/preparazioni/{workspace}/input')
async def upload(request: Request, workspace: UUID):
    """Retain exact UTF-8 bytes and operator attestation without a multipart parser."""
    raw, expected, public, key = await read_text(request)
    return reply(await execute(request, 'SELECT preparation.put_input(%s,%s,\'text\',%s,%s,%s) AS result',
        (workspace, expected, raw, Jsonb(public), key), True), 201)


@router.get('/preparazioni/{workspace}/input/{input_id}')
async def original(request: Request, workspace: UUID, input_id: UUID):
    """Return exact authorized retained bytes, including an original BOM if present."""
    value = await execute(request, 'SELECT preparation.read_input(%s,%s) AS result', (workspace, input_id))
    return Response(base64.b64decode(value['original_base64']), media_type='text/plain; charset=utf-8',
                    headers={'X-EGI-Schema-Version': '1'})


@router.post('/preparazioni/{workspace}/schede/crea')
async def create_items(request: Request, workspace: UUID):
    """Create manually selected blank cards or selected successful interpretation candidates."""
    body = await read_json(request, ('input_id', 'job_id', 'selections', 'request_key'))
    if not isinstance(body['selections'], list) or not 1 <= len(body['selections']) <= 1000:
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT preparation.create_items(%s,%s,%s,%s,%s) AS result',
        (workspace, identifier(body['input_id']), identifier(body['job_id'], True), Jsonb(body['selections']), identifier(body['request_key'])), True), 201)


@router.get('/preparazioni/{workspace}/schede/{item}')
async def item(request: Request, workspace: UUID, item: UUID, version: UUID | None = None):
    """Read an authorized current card or an immutable historical version."""
    return reply(await execute(request, 'SELECT preparation.read_item(%s,%s,%s) AS result', (workspace, item, version)))


@router.get('/preparazioni/{workspace}/schede/{item}/cronologia')
async def history(request: Request, workspace: UUID, item: UUID, after: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
    """Read bounded history without exposing unrelated preparations or original inputs."""
    return reply(await execute(request, 'SELECT preparation.read_history(%s,%s,%s,%s) AS result', (workspace, item, after, limit)))


@router.post('/preparazioni/{workspace}/schede')
async def save_items(request: Request, workspace: UUID):
    """Save a bounded atomic set of complete version-checked private cards."""
    body = await read_json(request, ('changes', 'request_key'))
    if not isinstance(body['changes'], list) or not 1 <= len(body['changes']) <= 1000:
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT preparation.save_items(%s,%s,%s) AS result',
        (workspace, Jsonb(body['changes']), identifier(body['request_key'])), True))


@router.post('/preparazioni/{workspace}/operazioni/{operation}/annulla')
async def undo(request: Request, workspace: UUID, operation: UUID):
    """Append compensation only if every affected card still has the expected head."""
    body = await read_json(request, ('request_key',))
    return reply(await execute(request, 'SELECT preparation.undo_operation(%s,%s,%s) AS result',
        (workspace, operation, identifier(body['request_key'])), True))


@router.post('/preparazioni/{workspace}/cestina')
async def trash(request: Request, workspace: UUID):
    """Move the owner's preparation into its recoverable private trash."""
    body = await read_json(request, ('expected_revision', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.trash_workspace(%s,%s,%s) AS result',
        (workspace, revision(body['expected_revision']), identifier(body['request_key'])), True))


@router.post('/preparazioni/{workspace}/ripristina')
async def restore(request: Request, workspace: UUID):
    """Restore an owned preparation within the retention period."""
    body = await read_json(request, ('expected_revision', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.restore_workspace(%s,%s,%s) AS result',
        (workspace, revision(body['expected_revision']), identifier(body['request_key'])), True))


@router.post('/fonti')
async def register_source(request: Request):
    """Register public source metadata without granting publication admission."""
    body = await read_json(request, ('metadata', 'request_key'))
    if not isinstance(body['metadata'], dict):
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT editorial.register_community_source(%s,%s) AS result',
        (Jsonb(body['metadata']), identifier(body['request_key'])), True), 201)


@router.post('/fonti/{source}/ammetti')
async def admit_source(request: Request, source: UUID):
    """Record a separate Admin decision allowing a registered source in publication."""
    body = await read_json(request, ('reason',))
    if not isinstance(body['reason'], str):
        raise Failure(422, 'invalid_request')
    return reply(await execute(request, 'SELECT editorial.admit_community_source(%s,%s) AS result', (source, body['reason']), True))
