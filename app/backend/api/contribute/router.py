"""`/contribuisci`: report an error, confirm a service or propose a new one (EGI-22).

The card's "Segnala un errore" and "Ancora valido" links carry `poi_id` and `issue`;
the menu's add-place entry carries neither and opens the new-service proposal.
Without a configured intake login in canonical mode the page only explains that
contributions are not available.
"""
from urllib.parse import parse_qs
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from ..directory.exceptions import DirectoryError
from ...presentation.catalog import Catalog
from ...config import ROOT

router = APIRouter()
CATEGORIES = ('hours', 'contacts', 'address', 'closed', 'other')
ISSUES = ('error', 'still_valid')
LIMITS = {'message': 2000, 'contact': 200, 'value': 500}
CATALOG = Catalog(ROOT / 'translations')


def page(request: Request, lang: str, status: int = 200, **context):
    """Render the contribution page in `lang`, falling back to Italian text."""
    response = request.app.state.resources.templates.TemplateResponse(request=request, name='pages/contribute.html',
        status_code=status, context={'t': lambda key, **values: CATALOG.text(key, lang, **values), 'lang': lang, **context})
    response.headers['Referrer-Policy'] = 'same-origin'  # 'no-referrer' makes browsers send Origin: null on POST
    return response


def target(request: Request, poi_id: str | None, lang: str) -> dict | None:
    """Return the public card a report is about, or None when it is not public."""
    directory = request.app.state.resources.directory
    try:
        return directory.detail(UUID(poi_id), lang) if directory and poi_id else None
    except (ValueError, DirectoryError):
        return None


def available(request: Request) -> bool:
    """Contributions need canonical mode and a configured intake login."""
    resources = request.app.state.resources
    return resources.configuration.canonical and resources.intake is not None


@router.get('/contribuisci', response_class=HTMLResponse)
def form(request: Request, lang: str = 'it', poi_id: str | None = None, issue: str | None = None):
    """Show the form for this card's issue, or the new-service proposal."""
    if not available(request):
        return page(request, lang, mode='unavailable')
    if issue in ISSUES:
        card = target(request, poi_id, lang)
        if card is None:
            return page(request, lang, status=404, mode='unknown_service')
        return page(request, lang, mode=issue, card=card, categories=CATEGORIES, values={})
    return page(request, lang, mode='new_service', values={})


@router.post('/contribuisci', response_class=HTMLResponse)
async def submit(request: Request):
    """Validate the form, hand it to intake and confirm receipt only."""
    if request.headers.get('origin') != f'{request.url.scheme}://{request.url.netloc}':
        raise HTTPException(403)
    body = await request.body()
    if len(body) > 16 * 1024:
        raise HTTPException(413)
    values = {key: items[-1].strip() for key, items in parse_qs(body.decode('utf-8', 'replace')).items()}
    lang, issue = values.get('lang', 'it'), values.get('issue')
    if not available(request):
        return page(request, lang, mode='unavailable')
    card = target(request, values.get('poi_id'), lang) if issue in ISSUES else None
    if issue in ISSUES and card is None:
        return page(request, lang, status=404, mode='unknown_service')
    mode = issue if issue in ISSUES else 'new_service'
    error = validate(mode, values)
    if error:
        return page(request, lang, status=400, mode=mode, card=card, categories=CATEGORIES, values=values, error=error)
    kind = {'error': 'report', 'still_valid': 'still_valid', 'new_service': 'new_service'}[mode]
    proposals = proposals_of(mode, values)
    contact = values.get('contact') if mode != 'still_valid' else None
    result = request.app.state.resources.intake.submit(kind, card['id'] if card else None,
        values.get('category') if mode == 'error' else None, values.get('message') if mode != 'still_valid' else None,
        contact, bool(values.get('consent')) and bool(contact), proposals, values.get('website'))
    if result in ('stored', 'trapped'):
        return page(request, lang, mode='received', kind=kind)
    if result in ('limited', 'closed'):
        return page(request, lang, status=503, mode='later')
    return page(request, lang, status=400, mode=mode, card=card, categories=CATEGORIES, values=values, error='invalid')


def proposals_of(mode: str, values: dict) -> list[dict]:
    """Return the structured values a visitor suggested: the corrected value, or the new service."""
    if mode == 'error':
        return [{'field': values['category'], 'value': values['value']}] if values.get('value') else []
    if mode == 'new_service':
        found = [{'field': key, 'value': values[key]} for key in ('name', 'offer', 'address', 'link') if values.get(key)]
        return found + ([{'field': 'online', 'value': 'sì'}] if values.get('online') else [])
    return []


def validate(mode: str, values: dict) -> str | None:
    """Return the first form error code, or None."""
    if any(len(values.get(key, '')) > limit for key, limit in LIMITS.items()):
        return 'too_long'
    if mode == 'error' and values.get('category') not in CATEGORIES:
        return 'category_required'
    if mode == 'new_service' and (not values.get('name') or not values.get('offer')):
        return 'name_and_offer_required'
    if mode != 'still_valid' and values.get('contact') and not values.get('consent'):
        return 'consent_required'
    return None
