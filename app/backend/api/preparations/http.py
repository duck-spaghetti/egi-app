"""Bound private input and return stable, content-free preparation errors.

PreparationRoute contains validation/database failures. read_json and read_text
consume bounded streams; execute verifies the session in the same transaction as
the fixed SQL operation. Existing moderation form limits remain unchanged.
"""
import json
import re
from uuid import UUID, uuid4

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from fastapi.encoders import jsonable_encoder
import psycopg
from starlette.concurrency import run_in_threadpool

from ..moderation import auth
from ..moderation.desk import Refused
from ..moderation.router import moderation
from ..moderation.service import HEADERS

MAX_JSON = 1024 * 1024
MAX_TEXT = 50000
SAFE_CODES = {
    'preparation_not_found': 404, 'input_not_found': 404, 'item_not_found': 404,
    'job_not_found': 404, 'operation_not_found': 404, 'source_not_found': 404,
    'preparation_permission_denied': 403, 'owner_required': 403, 'admin_required': 403,
    'session_invalid': 401, 'session_required': 401, 'account_not_active': 401,
    'second_factor_required': 403, 'preparation_owner_inactive': 403,
    'metadata_conflict': 409, 'input_conflict': 409, 'item_version_conflict': 409,
    'undo_head_conflict': 409, 'preparation_inactive': 409,
    'item_schema_downgrade': 409, 'source_fact_resolution_stale': 409,
    'reference_heads_changed': 409, 'taxonomy_context_stale': 409, 'organization_catalog_changed': 409,
    'organization_reconciliation_required': 409, 'invalid_reference_context': 422,
    'organization_catalog_context_required': 422, 'explicit_organization_role_required': 422,
    'explicit_fact_decision_required': 422, 'invalid_fact_action': 422,
    'invalid_catalog_query': 422, 'taxonomy_context_required': 422,
    'source_fact_identity_conflict': 422, 'source_fact_evidence_required': 422,
    'source_fact_manual_origin_required': 422, 'reference_resolution_not_available': 422,
    'organization_not_found':404, 'community_source_not_admitted':422, 'unpublished_organization':422,
    'community_acceptance_conflict':409, 'community_snapshot_heads_changed':409,
    'community_item_identity_conflict':409, 'community_lineage_unresolved':409,
    'item_not_confirmed':422, 'service_name_required':422,
    'unresolved_preparation_reference':422, 'invalid_preparation_vocabulary':422,
    'request_key_conflict': 409, 'stale_base': 409, 'stale_preparation': 409,
    'stale_item': 409, 'preparation_version_conflict': 409, 'undo_conflict': 409,
    'budget_unavailable': 429, 'ai_not_configured': 503, 'ai_configuration_unavailable': 503,
    'configuration_unavailable': 503, 'analysis_plan_not_found': 404, 'plan_not_found': 404,
    'analysis_record_not_found': 404, 'analysis_plan_not_started': 409,
    'analysis_plan_has_pending_dispatch': 409, 'analysis_plan_cancelled': 409,
    'analysis_packet_stale': 409, 'stale_workbench_packet': 409,
    'workbench_selection_stale': 409, 'workbench_selection_basis_changed': 409,
    'workbench_selection_record_mismatch': 422, 'invalid_workbench_selection': 422,
    'invalid_plan_limits': 422, 'explicit_uncertain_packet_required': 409,
    'plan_packet_limit': 413, 'plan_followup_limit': 413, 'plan_cost_limit': 429,
    'plan_bounds_exceeded': 413, 'packet_input_bound_exceeded': 413,
    'family_decomposition_needed': 413, 'comparison_decomposition_needed': 413,
    'group_not_found': 404, 'group_operation_not_found': 404, 'group_member_not_found': 404,
    'group_head_conflict': 409, 'group_parent_head_conflict': 409,
    'group_member_head_conflict': 409, 'competing_group_mapping': 409,
    'group_application_pending': 409, 'invalid_group_context': 409,
    'group_not_accepted': 409, 'group_catalog_limit': 413,
    'group_proposal_not_applicable': 422, 'group_proposal_not_retained': 422,
    'group_proposal_mapping_mismatch': 422, 'group_lineage_membership_mismatch': 422,
    'member_not_in_group': 422, 'mixed_group_context': 422,
    'unsupported_group_member': 422, 'invalid_group_revision': 422,
    'invalid_group_selection': 422, 'duplicate_group_member': 422,
    'workbench_result_not_found': 404, 'workbench_proposal_not_found': 404,
    'group_member_not_in_proposal': 422,
}


class Failure(Exception):
    """Carry an application-controlled status and non-sensitive error code."""

    def __init__(self, status, code):
        """Keep only the safe response attributes."""
        self.status, self.code = status, code


class PreparationRoute(APIRoute):
    """Contain input/database failures before global moderation HTML handlers."""

    def get_route_handler(self):
        """Wrap validation and execution with the preparation JSON error envelope."""
        original = super().get_route_handler()

        async def handle(request):
            """Return a private response without SQL, content or exception messages."""
            try:
                response = await original(request)
            except Failure as error:
                response = error_response(error.status, error.code)
            except RequestValidationError:
                response = error_response(422, 'invalid_request')
            except Refused as error:
                response = error_response(SAFE_CODES.get(error.code, 422),
                                          error.code if error.code in SAFE_CODES else 'invalid_request')
            except psycopg.Error as error:
                state = error.sqlstate or ''
                code = error.diag.message_primary
                if code in SAFE_CODES:
                    response = error_response(SAFE_CODES[code], code)
                else:
                    status = {'P0002': 404, '42501': 403, '40001': 409, '23505': 409}.get(state)
                    if status is None:
                        status = 422 if state.startswith(('22', '23', '55')) else 413 if state.startswith('54') else 503
                    response = error_response(status, {404: 'preparation_not_found', 403: 'forbidden',
                        409: 'version_conflict', 413: 'input_too_large', 422: 'invalid_request', 503: 'database_unavailable'}[status])
            except Exception as error:
                identifier = request.app.state.resources.diagnostics.record('internal_error', error)
                response = JSONResponse({'schema_version': 1, 'code': 'internal_error', 'request_id': identifier}, status_code=500)
            response.headers.update(HEADERS)
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
            return response
        return handle


def error_response(status, code):
    """Make a fresh correlation identifier without logging private request data."""
    return JSONResponse({'schema_version': 1, 'code': code, 'request_id': str(uuid4())}, status_code=status)


def reply(value, status=200):
    """Add the protocol version to an operation's JSON receipt or list."""
    body = value if isinstance(value, dict) else {'items': value}
    return JSONResponse(jsonable_encoder({**body, 'schema_version': 1}), status_code=status)


def session(request, mutation=False):
    """Require a cookie and, for mutation, same Origin plus the existing form token."""
    module = moderation(request)
    digest = module.session_hash(request)
    if not digest:
        raise Failure(401, 'session_required')
    token = request.headers.get('X-EGI-Form-Token', '')
    if mutation and (not module.same_origin(request) or not re.fullmatch(r'[0-9a-f]{64}', token) or not auth.form_token_matches(
            module.secret, digest, token)):
        raise Failure(403, 'invalid_form_token')
    return digest


async def execute(request, sql, params=(), mutation=False):
    """Run server-owned SQL with freshly verified identity and commit its receipt."""
    digest = session(request, mutation)
    desk = moderation(request).desk

    def operation():
        """Bind verification and operation to one database transaction."""
        with desk.acting(digest) as (connection, _):
            return connection.execute(sql, params).fetchone()['result']
    return await run_in_threadpool(operation)


async def bounded_bytes(request, maximum):
    """Stop reading at the bound even without Content-Length or with chunked input."""
    declared = request.headers.get('content-length')
    if declared is not None and (not declared.isascii() or not declared.isdecimal() or len(declared) > 20 or int(declared) > maximum):
        raise Failure(413 if declared.isdecimal() else 422, 'input_too_large' if declared.isdecimal() else 'invalid_request')
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > maximum:
            raise Failure(413, 'input_too_large')
        body.extend(chunk)
    return bytes(body)


def unique_object(pairs):
    """Reject duplicate JSON keys rather than accepting an ambiguous receipt body."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_key')
        result[key] = value
    return result


async def read_json(request, required, optional=()):
    """Read a bounded closed JSON object, rejecting malformed UTF-8 and non-JSON values."""
    session(request, True)
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise Failure(422, 'invalid_content_type')
    raw = await bounded_bytes(request, MAX_JSON)
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object,
                           parse_constant=reject_constant)
        json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (ValueError, UnicodeError, RecursionError):
        raise Failure(422, 'invalid_request') from None
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise Failure(422, 'invalid_request')
    return value


def reject_constant(_):
    """Reject NaN and Infinity accepted by the permissive Python JSON decoder."""
    raise ValueError('non_json_number')


def identifier(value, nullable=False):
    """Parse one UUID while rejecting non-string JSON representations."""
    if value is None and nullable:
        return None
    try:
        if not isinstance(value, str):
            raise Failure(422, 'invalid_request')
        return UUID(value)
    except ValueError:
        raise Failure(422, 'invalid_request') from None


def revision(value):
    """Accept only a nonnegative PostgreSQL bigint, excluding JSON booleans."""
    if type(value) is not int or not 0 <= value <= 9223372036854775807:
        raise Failure(422, 'invalid_request')
    return value


async def read_text(request):
    """Validate raw UTF-8 text and the exact upload precondition/attestation headers."""
    session(request, True)
    if request.headers.get('content-type', '').lower().replace(' ', '') != 'text/plain;charset=utf-8':
        raise Failure(422, 'invalid_content_type')
    expected = request.headers.get('X-EGI-Expected-Revision', '')
    public = request.headers.get('X-EGI-Public-Material')
    if not re.fullmatch(r'[0-9]{1,19}', expected) or public not in ('true', 'false'):
        raise Failure(422, 'invalid_upload_headers')
    key = identifier(request.headers.get('X-EGI-Request-Key'))
    expected = revision(int(expected))
    raw = await bounded_bytes(request, MAX_TEXT * 4 + 3)
    try:
        text = raw.decode('utf-8')
    except UnicodeError:
        raise Failure(422, 'invalid_utf8') from None
    if len(text.removeprefix('\ufeff')) > MAX_TEXT:
        raise Failure(413, 'input_too_large')
    if '\x00' in text:
        raise Failure(422, 'invalid_utf8')
    return raw, expected, public == 'true', key
