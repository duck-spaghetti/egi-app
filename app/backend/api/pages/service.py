"""Prepare safe page context and selected-reader health."""
from types import SimpleNamespace
from ...config import resolved
from ...presentation.languages import PREVIEW_LANGUAGES
from .exceptions import PageError
from .schemas import Health, PageSelection

class Pages:
    """Hide mode-specific bootstrap preparation from HTML routes."""
    def __init__(self, configuration, reader, source):
        """Accept only resources selected by application composition."""
        self.configuration, self.reader, self.source = configuration, reader, source

    def entry(self):
        """Return safe initial page values without a database read."""
        config = self.configuration
        return {'canonical': config.canonical, 'api_base': '/api/public' if config.canonical else '/api/preview',
                'profile': resolved(policy=config.policy)}

    def map(self, selection: PageSelection):
        """Resolve one map's public territory, language and bootstrap values."""
        if selection.city_id != 1:
            raise PageError(404)
        cfg = self.configuration
        language = next((x for x in PREVIEW_LANGUAGES if x['code'] == selection.lang), PREVIEW_LANGUAGES[0])
        public = resolved(self.reader.snapshot(selection.lang)['territory'] if cfg.canonical else None, cfg.policy)
        west, south, east, north = public['bounds']
        city = SimpleNamespace(id=1, name=public['name'], slug=public['territory_code'],
            center_lat=public['center'][1], center_lng=public['center'][0], default_zoom=public['zoom'],
            bbox_north=north, bbox_south=south, bbox_east=east, bbox_west=west)
        return {**self.entry(), 'city': city, 'language': SimpleNamespace(**language),
                'lang': language['code'], 'local_layers': cfg.local_layers if cfg.canonical else True, 'profile': public}

    def health(self):
        """Report the selected store without consulting the other reader."""
        if self.configuration.canonical:
            count = len(self.reader.snapshot()['services'])
        else:
            count = len(self.source.latest())
        return Health(status='ok', mode='canonical-local' if self.configuration.canonical else 'local-unreviewed-preview', services=count)
