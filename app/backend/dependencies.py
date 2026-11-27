"""Compose instance-owned readers and feature dependencies, with no import-time I/O."""
from dataclasses import dataclass
from functools import partial
from fastapi.templating import Jinja2Templates
from .config import ROOT, resolved
from .db import Db
from .diagnostics import Diagnostics
from .api.directory.service import Directory
from .api.pages.service import Pages
from .api.address_search.provider import Geocoder
from .api.address_search.service import AddressSearch
from .api.preview.service import Preview
from .api.preview.subjects import PostgresSubjectSource, run_psql
from .api.transport.service import Transport
from .api.transport import network, osm_rail
from .api.cycleways.service import Cycleways
from .api.map3d.service import Map3d
from .presentation.catalog import Catalog
from .api.contribute.intake import Intake

def moderation_for(settings, templates, overrides):
    """Build the moderation resources only when the editorial database is configured."""
    if settings is None:
        return None
    from .api.moderation.service import Moderation
    from .api.moderation.oidc import Oidc
    oidc = overrides.get('oidc')
    if oidc is None and settings.google_client_id and settings.google_client_secret:
        oidc = Oidc(settings.google_metadata_url, settings.google_client_id, settings.google_client_secret.get_secret_value())
    return Moderation(settings, templates, Catalog(ROOT / 'translations'), oidc, overrides.get('desk'))

