"""Show and explicitly publish canonical organizations linked to an accepted service.

The frame comes from an immutable Community resolution and the current canonical
service/location bodies. Existing governance owns scope, exact heads, evidence,
review and publication; no private source or organization profile writer is added.
"""
from ..moderation import places
from ..moderation.workspace import Workspace
from .http import Failure

HEADS = '''SELECT o.entity_id::text AS organization_id,w.revision_id::text AS working,p.revision_id::text AS public
 FROM data.organizations o LEFT JOIN governance.working_heads w USING(entity_id)
 LEFT JOIN governance.published_heads p USING(entity_id) WHERE o.entity_id=ANY(%s::uuid[]) AND w.revision_id IS NOT NULL'''


def linked_organizations(connection, module, contribution):
    """Read only organizations actually linked within this accepted editorial frame."""
    copied = connection.execute('SELECT editorial.read_community_snapshot(%s) AS value', (contribution,)).fetchone()['value']
    service = copied.get('resolved_service_id')
    if not copied.get('resolution') or not service:
        return []
    space = Workspace(module, connection, service)
    body = space.body(space.working or space.public) or {}
    ids = {item['organization_id'] for item in body.get('organizations', [])}
    location = (body.get('place') or {}).get('location_id')
    if location:
        heads = places.heads(connection, location)
        place = connection.execute('SELECT editorial.revision_body(%s) AS value', (heads['working'] or heads['public'],)).fetchone()['value']
        ids.update(item['organization_id'] for item in place.get('organizations', []))
    if not ids:
        return []
    # One round trip obtains the authorized canonical bodies; the serializer
    # still enforces draft visibility for each organization.
    sql = "SELECT h.*,editorial.revision_body(h.working::uuid) AS body FROM ("+HEADS+") h ORDER BY h.organization_id"
    rows = connection.execute(sql, (sorted(ids),)).fetchall()
    return [{**row, 'name': row['body'].get('name', ''), 'has_draft': row['working'] != row['public']} for row in rows]



def publish_linked(connection, module, contribution, organization, expected_work, expected_public, reason):
    """Approve/publish one explicitly selected linked draft, or acknowledge its replay."""
    if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 1000:
        raise Failure(422, 'invalid_request')
    found = next((item for item in linked_organizations(connection, module, contribution) if item['organization_id'] == str(organization)), None)
    if found is None:
        raise Failure(404, 'organization_not_found')
    if found['working'] == str(expected_work) and found['public'] == str(expected_work):
        return {'organization_id': str(organization), 'revision_id': str(expected_work), 'already_published': True}
    if found['working'] != str(expected_work) or found['public'] != (str(expected_public) if expected_public else None):
        raise Failure(409, 'reference_heads_changed')
    decision = connection.execute("SELECT governance.review_revision(%s,%s,'approved',%s) AS value",
                                  (expected_work, expected_public, reason.strip())).fetchone()['value']
    publication = connection.execute('SELECT governance.publish_revision(%s,%s,%s) AS value',
                                     (expected_work, decision, expected_public)).fetchone()['value']
    return {'organization_id': str(organization), 'revision_id': str(expected_work), 'publication_id': str(publication), 'already_published': False}
