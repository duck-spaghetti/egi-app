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
from .presentation.catalog import Catalog

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


@dataclass
class Resources:
    """Own the concrete resources selected for one application lifecycle."""
    configuration: object
    templates: object
    diagnostics: object
    reader: object
    source: object
    directory: object
    preview: object
    address_search: object
    geocoder: object
    cycleways: object
    moderation: object = None

    @classmethod
    def create(cls, configuration, overrides=None):
        """Construct selected dependencies; importing feature code creates no readers."""
        overrides = overrides or {}
        cfg = configuration
        reader = overrides.get('reader') or (Db(cfg.directory) if cfg.canonical else None)
        source = None if cfg.canonical else overrides.get('source') or PostgresSubjectSource(query=partial(run_psql, dsn=cfg.preview_dsn, executable=cfg.psql, runtime_path=cfg.preview_runtime))
        directory = Directory(reader, cfg.policy) if cfg.canonical else None
        preview = Preview() if not cfg.canonical else None
        def country():
            """Resolve only this instance's territory country for explicit searches."""
            return resolved(reader.snapshot()['territory'] if cfg.canonical else None, cfg.policy)['country_code']
        geocoder = overrides.get('geocoder') or Geocoder(cfg.policy, country,
            cfg.geocoder_url, cfg.rate_file)
        templates = Jinja2Templates(directory=ROOT / 'app/frontend/templates')
        return cls(cfg, templates,
            overrides.get('diagnostics') or Diagnostics(cfg.error_dir), reader, source, directory, preview,
            AddressSearch(geocoder), geocoder, Cycleways(cfg.policy, cfg.cycle_root),
            moderation_for(cfg.editorial, templates, overrides))

    def close(self):
        """Release only resources owned by this application's lifecycle."""
        self.geocoder.close()
        if self.reader:
            self.reader.close()

    def pages_for(self, source):
        """Prepare page behavior with the source selected at the request's real Seam."""
        return Pages(self.configuration, self.reader, source)

    def transport_for(self, source):
        """Construct local-layer behavior with the selected canonical/preview points."""
        if self.configuration.canonical:
            points = self.directory.points
        else:
            def points():
                """Supply only this request's substituted preview source points."""
                return self.preview.points(source.latest())
        cfg = self.configuration
        return Transport(points, cfg.transport_roots, cfg.osm_root, cfg.policy)
