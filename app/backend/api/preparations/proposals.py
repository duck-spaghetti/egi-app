"""Inspect bounded private proposals and materialize explicit unconfirmed selections.

Source ownership, frozen choices and writes remain database-owned. Human labels and
quoted member details reuse the existing exact historical group projection.
"""
from uuid import UUID

from fastapi import APIRouter, Query, Request
from psycopg.types.json import Jsonb

from .http import Failure, PreparationRoute, execute, identifier, read_json, reply, revision
from .groups import member_details, private_read

router = APIRouter(prefix='/moderazione/contribuisci/api/preparazioni', route_class=PreparationRoute)


def result_keys(value):
    """Validate a bounded explicit set of request-local proposal or hypothesis keys."""
    if not isinstance(value, list) or not 1 <= len(value) <= 100 or any(
            not isinstance(key, str) or not 1 <= len(key) <= 300 for key in value):
        raise Failure(422, 'invalid_workbench_selection')
    if len(set(value)) != len(value):
        raise Failure(422, 'invalid_workbench_selection')
    return value



def proposal_key(value, nullable=False):
    """Validate an opaque model-local key kept in a protected request body."""
    if value is None and nullable:
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= 300 or not value.strip():
        raise Failure(422, 'invalid_request')
    return value



def paging(body):
    """Bound JSON read cursors before PostgreSQL integer adaptation or offset work."""
    offset, limit = revision(body.get('offset', 0)), revision(body.get('limit', 50))
    if offset > 100000 or not 1 <= limit <= 100:
        raise Failure(422, 'invalid_request')
    return offset, limit



@router.get('/{workspace}/lavori/{job}/proposte')
async def proposals(request: Request, workspace: UUID, job: UUID, item: UUID | None = None,
                    offset: int = Query(0, ge=0, le=100000), limit: int = Query(50, ge=1, le=100)):
    """Read validated proposal choices and bounded original support for one owned scope."""
    return reply(await execute(request, 'SELECT preparation.read_workbench_proposals(%s,%s,%s,%s,%s) AS result',
        (workspace, job, item, offset, limit)))



@router.post('/{workspace}/lavori/{job}/proposte/elementi')
async def proposal_members(request: Request, workspace: UUID, job: UUID):
    """Resolve a retained group proposal to exact owned member identities in pages."""
    body = await read_json(request, ('proposal_key',), ('offset', 'limit'))
    offset, limit = paging(body)
    key = proposal_key(body['proposal_key'])

    def read(connection):
        """Resolve human-readable evidence under the same current workspace ACL."""
        result = connection.execute(
            'SELECT preparation.read_workbench_proposal_members(%s,%s,%s,%s,%s) AS result',
            (workspace, job, key, offset, limit)).fetchone()['result']
        result['details'] = member_details(connection, workspace, result['members'])
        return result
    return reply(await private_read(request, read, True))



@router.post('/{workspace}/lavori/{job}/proposte/passaggi')
async def proposal_supports(request: Request, workspace: UUID, job: UUID):
    """Page referenced passages without placing arbitrary proposal text in access-log URLs."""
    body = await read_json(request, ('item_id', 'proposal_key'), ('offset', 'limit'))
    offset, limit = paging(body)
    return reply(await execute(request, 'SELECT preparation.read_workbench_supports(%s,%s,%s,%s,%s,%s) AS result',
        (workspace, job, identifier(body['item_id'], True), proposal_key(body['proposal_key'], True), offset, limit)))



@router.post('/{workspace}/lavori/{job}/schede/{item}/proposte')
async def select_proposals(request: Request, workspace: UUID, job: UUID, item: UUID):
    """Materialize only explicitly selected unconfirmed proposals on an exact item head."""
    body = await read_json(request, ('expected_version', 'proposal_keys', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.select_workbench_proposals(%s,%s,%s,%s,%s,%s) AS result',
        (workspace, job, item, identifier(body['expected_version']), Jsonb(result_keys(body['proposal_keys'])), identifier(body['request_key'])), True))



@router.post('/{workspace}/lavori/{job}/schede/{item}/ipotesi')
async def select_hypotheses(request: Request, workspace: UUID, job: UUID, item: UUID):
    """Materialize selected hypotheses as unverified, separately from category proposals."""
    body = await read_json(request, ('expected_version', 'hypothesis_keys', 'request_key'))
    return reply(await execute(request, 'SELECT preparation.select_workbench_hypotheses(%s,%s,%s,%s,%s,%s) AS result',
        (workspace, job, item, identifier(body['expected_version']), Jsonb(result_keys(body['hypothesis_keys'])), identifier(body['request_key'])), True))
