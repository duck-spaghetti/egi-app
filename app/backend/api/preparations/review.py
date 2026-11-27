"""Selective Community moderation context and canonical draft acceptance.

Reads use only immutable submitted snapshots plus already-authorized canonical
aggregates. Private preparation inputs, siblings and history are never queried.
Publication stays in the existing canonical workspace.
"""
from uuid import UUID

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb

from .fields import dictionary, references
from .http import Failure, PreparationRoute, execute, identifier, read_json, reply
from ..moderation import decisions, places
from ..moderation.workspace import Workspace

router = APIRouter(prefix='/moderazione/contributo',route_class=PreparationRoute)


def without_evidence(value):
    """Copy canonical values for comparison without accepting caller-supplied proof."""
    if isinstance(value,dict):
        return {key:without_evidence(child) for key,child in value.items() if key!='evidence'}
    if isinstance(value,list):
        return [without_evidence(child) for child in value]
    return value


def review_context(connection, item: dict, module, query='') -> dict:
    """Provide a snapshot-only proposal and a complete exact-head canonical baseline."""
    copied = connection.execute('SELECT editorial.read_community_snapshot(%s) AS copied',(item['contribution_id'],)).fetchone()['copied']
    snapshot = copied['snapshot']
    target = snapshot['values']['target']
    service = copied['resolved_service_id'] or target.get('service_id')
    baseline,working,public = {},None,None
    if service:
        space = Workspace(module,connection,service)
        working,public = space.working,space.public
        baseline = space.body(working or public) or {}
    proxy = {**item,'service_id':service}
    shared = decisions.context(connection,proxy,query)
    shared['community'] = {'snapshot':snapshot,'diagnostics':copied['diagnostics'],
        'resolution':copied.get('resolution'),'service_id':service,'baseline':without_evidence(baseline),
        'working':working,'public':public,'fields':dictionary(),'references':references(connection),'text':module.catalog.languages['it']['community'],
        'methods':places.METHODS,'closed':item['state']=='closed'}
    resolution = copied.get('resolution')
    if resolution:
        accepted = connection.execute('SELECT editorial.revision_body(%s) AS body',(resolution['initial_revision_id'],)).fetchone()['body']
        shared['community']['accepted_service'] = without_evidence(accepted)
        location_id = (accepted.get('place') or {}).get('location_id')
        if location_id:
            found = places.heads(connection,location_id)
            location_body = connection.execute('SELECT editorial.revision_body(%s) AS body',(found['working'] or found['public'],)).fetchone()['body']
            shared['community']['accepted_location'] = {'kind':'existing','location_id':location_id,'action':'reuse','body':without_evidence(location_body)}
    shared['community_observation_source'] = connection.execute(
        "SELECT r.source_id::text AS source_id,r.name,EXISTS(SELECT FROM governance.community_source_admissions a WHERE a.source_id=r.source_id) AS admitted FROM sources.registry r WHERE r.code='egi_editorial'").fetchone()
    shared['community_source_admitted'] = connection.execute(
        'SELECT EXISTS(SELECT FROM governance.community_source_admissions WHERE source_id=%s) AS admitted',
        (snapshot['source_id'],)).fetchone()['admitted']
    return shared


@router.post('/{contribution}/accetta-community')
async def accept(request: Request, contribution: UUID):
    """Accept one immutable snapshot into a draft; never review/publish implicitly."""
    body = await read_json(request,('decision','request_key'))
    if not isinstance(body['decision'],dict):
        raise Failure(422,'invalid_request')
    return reply(await execute(request,'SELECT editorial.accept_community_item(%s,%s,%s) AS result',
        (contribution,Jsonb(body['decision']),identifier(body['request_key'])),True))
