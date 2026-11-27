"""Serve real application shells with synthetic public reads and editorial fixtures.

This test-only ASGI entrypoint never opens a database, constructs a worker or
dispatches provider calls. Browser contexts supply their own synthetic API replies.
"""
import hashlib
from pathlib import Path
from uuid import UUID
from fastapi import Request
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.templating import Jinja2Templates
from app.backend.config import Configuration, DirectorySettings, ROOT, profile
from app.backend.main import create_app
from app.backend.presentation.catalog import Catalog
from app.backend.api.preparations.fields import dictionary

SOURCE = 'Associazione Alfa · catalogo sintetico'
ORIGINAL = 'Sportello orientamento. Associazione Alfa gestisce il servizio; Comune Beta lo finanzia. Categoria originale: aiuto documenti. Orari da verificare.'
WID, ITEM, VERSION, INPUT = (str(UUID(int=i)) for i in range(101, 105))


class Reader:
    """Supply only synthetic canonical public records through the existing read seam."""

    def snapshot(self, language='it'):
        """Return public shape, provenance and Unicode content for both print languages."""
        title = 'مكتب المساعدة' if language == 'ar' else 'Sportello orientamento'
        service = {'service_id': str(UUID(int=1)), 'revision_id': str(UUID(int=2)),
            'name': {'text': title}, 'description': {'text': 'Informazioni e orientamento · città'},
            'classifications': [{'term_id': str(UUID(int=6))}], 'sources': [{'source_id': str(UUID(int=3)), 'name': SOURCE,
                'homepage': 'https://example.invalid/catalogo', 'license': 'Synthetic test data',
                'retrieved_at': '2026-11-20T10:00:00Z', 'published_at': '2026-11-19T10:00:00Z'}],
            'contacts': [], 'conditions': [], 'weekly_hours': [], 'delivery_mode': 'in_person',
            'cost': {'state': 'unknown', 'note': None}, 'operational_status': 'active',
            'opening': {'status': 'unknown'}, 'valid_from': None, 'valid_until': None,
            'place': {'location_id': str(UUID(int=4)), 'latitude': 41.9, 'longitude': 12.5,
                'addresses': [{'kind': 'physical', 'formatted': 'Via Esempio 10, Roma'}], 'coordinate_state': 'known'}}
        return {'services': [service], 'taxonomy': [{'term_id': str(UUID(int=6)), 'axis_code': 'need', 'name': {'text': 'Orientamento'}, 'presentation': {'code': 'orientamento', 'icon': 'office', 'color': '#466b70'}}], 'supplements': [],
            'evaluated_at': '2026-11-27T10:00:00Z',
            'territory': {'territory_id': str(UUID(int=5)), 'code': 'roma'}}

    def close(self):
        """The fixture owns no connection or external process."""


def payload():
    """Provide literal organization/category facts with explicit confirmed roles."""
    facts = [{'fact_id': str(UUID(int=10+i)), 'subject': 'service', 'kind': kind,
              'source_value': value, 'value': value} for i, (kind, value) in enumerate([
        ('organization_name', 'Associazione Alfa'), ('organization_name', 'Comune Beta'),
        ('category_label', 'aiuto documenti')])]
    resolutions = [{'fact_id': facts[i]['fact_id'], 'state': 'confirmed', 'context': {}, 'candidates': [],
        'selected': {'target': {'kind': 'organization', 'organization_id': str(UUID(int=20+i))}, 'role': role},
        'confirmation': {'actor_id': str(UUID(int=30))}} for i, role in enumerate(['provider', 'finanziatore'])]
    resolutions.append({'fact_id': facts[2]['fact_id'], 'state': 'confirmed', 'context': {}, 'candidates': [],
        'selected': {'target': {'kind': 'category', 'adoption_id': str(UUID(int=50)), 'term_id': str(UUID(int=51))}},
        'confirmation': {'actor_id': str(UUID(int=30))}})
    return {'schema_version': 2, 'service': {'name': 'Sportello orientamento', 'description': 'Orari da verificare',
        'original_language': 'it', 'delivery_mode': 'in_person'}, 'location': {'kind': 'none'},
        'target': {'kind': 'new'}, 'outcome': 'review', 'field_origins': {}, 'source_facts': facts,
        'resolutions': resolutions, 'evidence': [{'id': str(UUID(int=40+i)), 'path': f'/source_facts/{i}/source_value',
            'input_id': INPUT, 'input_hash': hashlib.sha256(ORIGINAL.encode()).hexdigest(), 'kind': 'stated', 'quote': fact['value'],
            'span': {'start': ORIGINAL.index(fact['value']), 'end': ORIGINAL.index(fact['value']) + len(fact['value'])}} for i, fact in enumerate(facts)]}


REFERENCES = {'territories': [], 'classifications': [{'adoption_id': str(UUID(int=50)), 'term_id': str(UUID(int=51)), 'name': 'Supporto sociale', 'axis_label': 'Bisogno'}], 'organizations': [
    {'organization_id': str(UUID(int=20)), 'name': 'Associazione Alfa'},
    {'organization_id': str(UUID(int=21)), 'name': 'Comune Beta'}]}
catalog = Catalog(ROOT / 'translations')
templates = Jinja2Templates(directory=ROOT / 'app/frontend/templates')
app = create_app(Configuration(profile(), canonical=True, error_dir=ROOT / '.local/browser/errors',
    directory=DirectorySettings(database_url='synthetic-never-opened')), {'reader': Reader()})


@app.get('/__fixtures/health')
def fixture_health():
    """Identify the synthetic origin before an automated client acts on it."""
    return {'synthetic': True, 'provider': 'disabled', 'database': 'not-used'}


@app.get('/__fixtures/preparation')
def preparation():
    """Expose only this synthetic scenario's IDs and initial private-card fixture."""
    return {'id': WID, 'item': ITEM, 'version': VERSION, 'input': INPUT,
            'source': str(UUID(int=3)), 'payload': payload(), 'original': ORIGINAL}


@app.get('/__fixtures/native-print')
def native_print():
    """Prepare only the named synthetic print fixture on the isolated milestone origin."""
    return HTMLResponse('<!doctype html><html lang="it"><meta charset="utf-8"><title>Preparazione verifica stampa</title><p>Preparazione lista sintetica EGI-137…</p><script type="module" src="/__fixtures/native-print.js"></script></html>')


@app.get('/__fixtures/native-print.js')
def native_script():
    """Serve the inspectable native acceptance fixture, separate from product assets."""
    return FileResponse(Path(__file__).with_name('native_print.js'), media_type='application/javascript')


@app.get('/moderazione/contribuisci')
@app.get('/moderazione/contributo/fixture')
def community(request: Request):
    """Render actual editorial templates only for a synthetic authenticated session."""
    if request.cookies.get('egi_fixture') != 'moderator':
        return JSONResponse({'code': 'fixture_session_required'}, status_code=401)
    person = {'actor_id': str(UUID(int=30)), 'display_name': 'Moderatore sintetico', 'role': 'moderator'}
    common = {'request': request, 'person': person, 'form_token': 'synthetic-only-token',
              't': catalog.text, 'google': False}
    if request.url.path.endswith('contribuisci'):
        common['preparation_context'] = {'sources': [{'id': str(UUID(int=3)), 'name': SOURCE}],
            'fields': dictionary(), 'references': REFERENCES, 'text': catalog.languages['it']['community'],
            'capabilities': {'item_payload_versions': [1, 2], 'interpretation_result_versions': [1, 2]}}
        name = 'preparations.html'
    else:
        values = payload()
        common.update(item={'kind': 'new_service', 'state': 'new', 'contribution_id': 'fixture', 'events': []},
            people=[], reasons=[], outcomes=[], publications=[], community_source_admitted=True,
            community={'snapshot': {'contribution_id': 'fixture', 'item_id': ITEM, 'item_version_id': VERSION,
                'values': values, 'evidence': values['evidence'], 'source_id': str(UUID(int=3)),
                'source_metadata': {'name': SOURCE}, 'submitted_at': '2026-11-27T10:00:00Z'},
                'baseline': {}, 'fields': dictionary(), 'references': REFERENCES,
                'text': catalog.languages['it']['community'], 'methods': [], 'closed': False,
                'organizations': [], 'service_id': None, 'resolution': None})
        name = 'community-review.html'
    return templates.TemplateResponse(request=request, name='moderation/' + name, context=common)
