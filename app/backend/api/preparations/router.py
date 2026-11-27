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

from .literal import prepared_fact
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
    """Read authorized metadata and bounded named summaries without full payloads."""
    value = await execute(request, 'SELECT preparation.read_workspace(%s) AS result', (workspace,))
    if value.get('current_input_id'):
        value['input_metadata'] = await execute(request, "SELECT preparation.read_input(%s,%s)-'original_base64' AS result", (workspace, value['current_input_id']))
    items = value['items']
    summaries = []
    for item in items[offset:offset + limit]:
        summary = {k: v for k, v in item.items() if k != 'payload'}
        name = item.get('payload', {}).get('service', {}).get('name')
        summary['display_name'] = name[:160] if name else None
        summaries.append(summary)
    value['items'] = summaries
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


@router.post('/preparazioni/{workspace}/schede/{item}/fatto-preparato')
async def prepare_literal(request: Request, workspace: UUID, item: UUID):
    """Derive an unsaved fact from retained bytes; persistence uses ordinary save."""
    body = await read_json(request, ('input_id', 'kind', 'subject', 'selection'))
    input_id = identifier(body['input_id'])
    value = await execute(request, "SELECT jsonb_build_object('item',preparation.read_item(%s,%s,NULL),'input',preparation.read_input(%s,%s)) AS result",
                          (workspace, item, workspace, input_id))
    return reply(prepared_fact(value['input'], {**body, 'input_id': input_id}))


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


@router.post('/preparazioni/{workspace}/analisi')
async def analysis(request: Request, workspace: UUID):
    """Queue one eligible durable interpretation; later retries require explicit keys."""
    body = await read_json(request, ('input_id','task','request_key'))
    if body['task'] != 'extract_text':
        raise Failure(422,'invalid_request')
    return reply(await execute(request, 'SELECT preparation.request_interpretation(%s,%s,%s,%s) AS result',
        (workspace,identifier(body['input_id']),body['task'],identifier(body['request_key'])),True),202)


@router.get('/preparazioni/{workspace}/lavori/{job}')
async def job(request: Request, workspace: UUID, job: UUID):
    """Read authorized status/results without exposing worker leases or raw originals."""
    return reply(await execute(request,'SELECT preparation.read_job(%s,%s) AS result',(workspace,job)))


@router.post('/preparazioni/{workspace}/lavori/{job}/annulla')
async def cancel_job(request: Request, workspace: UUID, job: UUID):
    """Cancel result use while keeping any already-dispatched usage accountable."""
    body = await read_json(request,('request_key',))
    return reply(await execute(request,'SELECT preparation.cancel_job(%s,%s,%s) AS result',
        (workspace,job,identifier(body['request_key'])),True))


@router.post('/preparazioni/{workspace}/invii')
async def submit(request: Request, workspace: UUID):
    """Submit selected heads independently, preserving stable per-item retry receipts."""
    from uuid import uuid4, uuid5
    import psycopg
    from ..moderation.desk import Refused
    from .http import SAFE_CODES

    body = await read_json(request,('request_key','items'))
    key = identifier(body['request_key'])
    if not isinstance(body['items'],list) or not 1 <= len(body['items']) <= 1000:
        raise Failure(422,'invalid_request')
    items = []
    for value in body['items']:
        if not isinstance(value,dict) or set(value) != {'item_id','expected_version'}:
            raise Failure(422,'invalid_request')
        items.append((identifier(value['item_id']),identifier(value['expected_version'])))
    if len({item for item,_ in items}) != len(items):
        raise Failure(422,'invalid_request')
    await execute(request,'SELECT preparation.read_workspace(%s) AS result',(workspace,))
    outcomes = []
    for item,version in items:
        try:
            receipt = await execute(request,'SELECT preparation.submit_item(%s,%s,%s,%s) AS result',
                (workspace,item,version,uuid5(key,str(item))),True)
            outcomes.append({'item_id':str(item),'outcome':'submitted','receipt':receipt})
        except Refused as error:
            status = SAFE_CODES.get(error.code,422)
            outcomes.append({'item_id':str(item),'outcome':'excluded','status':status,
                'code':error.code if error.code in SAFE_CODES else 'invalid_request','request_id':str(uuid4())})
        except psycopg.Error as error:
            status = {'P0002':404,'42501':403,'40001':409}.get(error.sqlstate,503)
            outcomes.append({'item_id':str(item),'outcome':'excluded','status':status,
                'code':{404:'preparation_not_found',403:'forbidden',409:'version_conflict',503:'database_unavailable'}[status],'request_id':str(uuid4())})
    status = 200 if any(item['outcome']=='submitted' for item in outcomes) else outcomes[0]['status']
    envelope={'items':outcomes}
    if status>=400:
        envelope.update(code=outcomes[0]['code'],request_id=outcomes[0]['request_id'])
    return reply(envelope,status)
