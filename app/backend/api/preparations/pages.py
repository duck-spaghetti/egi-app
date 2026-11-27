"""Render the private editor shell using existing editorial identity and catalogs."""
from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from .fields import dictionary, references
from .http import PreparationRoute, session
from ..moderation.router import moderation

router = APIRouter(prefix='/moderazione/contribuisci', route_class=PreparationRoute)


@router.get('')
@router.get('/')
async def editor(request: Request):
    """Render an authenticated shell; originals and cards load through private APIs."""
    module = moderation(request)
    digest = session(request)

    def context():
        """Read only registered source metadata as the freshly verified person."""
        with module.desk.acting(digest) as (connection, person):
            sources = connection.execute('SELECT source_id::text AS id,name FROM sources.registry ORDER BY name,source_id').fetchall()
            return person, sources, references(connection)
    person, sources, options = await run_in_threadpool(context)
    return module.render(request, 'preparations.html', person,
        preparation_context={'sources': sources, 'fields': dictionary(), 'references': options,
            'capabilities': {'item_payload_versions': [1, 2], 'interpretation_result_versions': [1, 2]},
            'text': module.catalog.languages['it']['community']})
