"""The contribution queue: grouped by service, filtered, claimed and handed over (EGI-24).

Every read and step runs as the verified person; the database records who did what.
A claim never locks the service: publication keeps its exact-revision check.
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from .desk import Refused
from .service import Moderation, PATH

router = APIRouter()
STATES = ('new', 'claimed', 'waiting', 'closed')
KINDS = ('report', 'still_valid', 'new_service')
CATEGORIES = ('hours', 'contacts', 'address', 'closed', 'other')
REASONS = ('evidence', 'submitter', 'admin')
# The current public name of each service, read as the editorial login.
NAMES = '''SELECT h.entity_id::text AS service_id,n.original_text AS name FROM governance.published_heads h
 JOIN data.service_revisions s ON s.revision_id=h.revision_id LEFT JOIN i18n.content_units n ON n.content_id=s.name_content_id
 WHERE h.entity_id=ANY(%s::uuid[])'''


def moderation(request: Request) -> Moderation:
    """Return this application's moderation resources."""
    return request.app.state.resources.moderation


def chosen(value: str | None, allowed: tuple) -> str | None:
    """Keep a filter value only when it is one of the allowed codes."""
    return value if value in allowed else None


@router.get('/coda', response_class=HTMLResponse)
def queue(request: Request, stato: str | None = None, tipo: str | None = None, categoria: str | None = None,
          attesa: str | None = None, in_carico: str | None = None, module: Moderation = Depends(moderation)):
    """List contributions grouped by service, with the selected filters."""
    session = module.session_hash(request)
    filters = {'stato': chosen(stato, STATES), 'tipo': chosen(tipo, KINDS), 'categoria': chosen(categoria, CATEGORIES),
               'attesa': chosen(attesa, REASONS), 'in_carico': in_carico if in_carico in ('me', 'none') else None}
    with module.desk.acting(session) as (connection, person):
        rows = connection.execute('SELECT * FROM editorial.list_contributions(%s)', (filters['stato'] == 'closed',)).fetchall()
        rows = [row for row in rows if keep(row, filters, person)]
        names = {row['service_id']: row['name'] for row in connection.execute(
            NAMES, ([str(row['service_id']) for row in rows if row['service_id']],)).fetchall()}
    groups, singles = {}, []
    for row in rows:
        if row['service_id']:
            groups.setdefault(str(row['service_id']), []).append(row)
        else:
            singles.append(row)
    services = [{'service_id': key, 'name': names.get(key) or key, 'contributions': items} for key, items in groups.items()]
    return module.render(request, 'queue.html', person, services=services, singles=singles, filters=filters,
                         states=STATES, kinds=KINDS, categories=CATEGORIES, reasons=REASONS)


def keep(row: dict, filters: dict, person: dict) -> bool:
    """Apply the queue filters to one contribution."""
    return ((not filters['stato'] or row['state'] == filters['stato'])
            and (not filters['tipo'] or row['kind'] == filters['tipo'])
            and (not filters['categoria'] or row['category'] == filters['categoria'])
            and (not filters['attesa'] or row['waiting_reason'] == filters['attesa'])
            and (filters['in_carico'] != 'me' or str(row['claimed_by']) == person['actor_id'])
            and (filters['in_carico'] != 'none' or row['claimed_by'] is None))


def contribution_page(request: Request, module: Moderation, contribution: str, **context):
    """Render one contribution with its history and the people it can go to."""
    from .decisions import context as decision_context

    with module.desk.acting(module.session_hash(request)) as (connection, person):
        item = connection.execute('SELECT editorial.read_contribution(%s) AS item', (contribution,)).fetchone()['item']
        people = connection.execute('SELECT * FROM editorial.list_moderators()').fetchall()
        name = connection.execute(NAMES, ([item['service_id']] if item['service_id'] else [],)).fetchone()
        if item.get('author_kind') == 'community':
            from ..preparations.review import review_context
            review = review_context(connection,item,module,request.query_params.get('q','')[:200])
            template = 'community-review.html'
        else:
            review = decision_context(connection, item, request.query_params.get('q', '')[:200])
            template = 'contribution.html'
    return module.render(request, template, person, item=item, people=people,
                         service_name=name['name'] if name else None, reasons=REASONS, **review, **context)


@router.get('/contributo/{contribution}', response_class=HTMLResponse)
def contribution(request: Request, contribution: str, module: Moderation = Depends(moderation)):
    """Show one contribution: text, contact, proposals and every step taken."""
    return contribution_page(request, module, contribution)


@router.post('/contributo/{contribution}/presa')
async def claim(request: Request, contribution: str, module: Moderation = Depends(moderation)):
    """Claim, take over, release or hand the contribution to another person."""
    form = await module.form(request)
    module.check_post(request, form)
    try:
        module.desk.as_person(module.session_hash(request), 'SELECT editorial.claim(%s,%s,%s)',
                              (contribution, form.get('action', 'claim'), form.get('assignee') or None))
    except Refused as refusal:
        return contribution_page(request, module, contribution, error=refusal.code)
    return RedirectResponse(f'{PATH}/contributo/{contribution}', status_code=303)


@router.post('/contributo/{contribution}/attesa')
async def waiting(request: Request, contribution: str, module: Moderation = Depends(moderation)):
    """Put the contribution on hold with a reason, or resume it (empty reason)."""
    form = await module.form(request)
    module.check_post(request, form)
    try:
        module.desk.as_person(module.session_hash(request), 'SELECT editorial.set_waiting(%s,%s)',
                              (contribution, form.get('reason') or None))
    except Refused as refusal:
        return contribution_page(request, module, contribution, error=refusal.code)
    return RedirectResponse(f'{PATH}/contributo/{contribution}', status_code=303)
