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
    map3d: object

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
        return cls(cfg, Jinja2Templates(directory=ROOT / 'app/frontend/templates'),
            overrides.get('diagnostics') or Diagnostics(cfg.error_dir), reader, source, directory, preview,
            AddressSearch(geocoder), geocoder, Cycleways(cfg.policy, cfg.cycle_root),
            overrides.get('map3d') or Map3d(cfg.map3d_root))

    def close(self):
        """Release only resources owned by this application's lifecycle."""
        self.geocoder.close()
        if self.reader:
            self.reader.close()

    def pages_for(self, source):
        """Prepare page behavior with the source selected at the request's real Seam."""
        return Pages(self.configuration, self.reader, source, self.map3d)

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
