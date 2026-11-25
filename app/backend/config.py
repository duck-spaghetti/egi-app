"""Validate application configuration once for each application instance."""
from dataclasses import dataclass
import math
import os
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import yaml
from .queries.catalogue import UniqueLoader

ROOT = Path(__file__).resolve().parents[2]

class DirectorySettings(BaseSettings):
    """Configuration for one PostgreSQL public-directory reader."""

    model_config = SettingsConfigDict(env_prefix="EGI_", hide_input_in_errors=True)
    db_backend: Literal["postgres"] = "postgres"
    database_url: SecretStr
    territory_code: str = "roma"
    query_catalogue: Path = Path(__file__).with_name("queries") / "public.yaml"


def settings() -> DirectorySettings:
    """Fail startup without echoing configuration or secret-bearing validation inputs."""
    try:
        result = DirectorySettings()
        if not result.database_url.get_secret_value().strip() or not result.territory_code.strip():
            raise ValueError("empty required setting")
        return result
    except (ValidationError, ValueError):
        raise RuntimeError("Invalid canonical directory configuration") from None


class EditorialSettings(BaseSettings):
    """Configuration of the moderation Module; absent means moderation is not mounted.

    `database_url` names the editorial login (`IN ROLE egi_editorial`). The cookie
    secret signs form tokens and the short-lived OpenID Connect cookie. Google sign-in
    is offered only when its client id and secret are set.
    """

    model_config = SettingsConfigDict(env_prefix="EGI_EDITORIAL_", hide_input_in_errors=True)
    database_url: SecretStr
    intake_database_url: SecretStr | None = None
    cookie_secret: SecretStr = Field(min_length=32)
    secure_cookie: bool = True
    google_client_id: str | None = None
    google_client_secret: SecretStr | None = None
    google_metadata_url: str = "https://accounts.google.com/.well-known/openid-configuration"


def editorial_settings() -> EditorialSettings | None:
    """Return moderation settings when configured; fail startup on invalid values."""
    if not os.environ.get("EGI_EDITORIAL_DATABASE_URL"):
        return None
    try:
        return EditorialSettings()
    except ValidationError:
        raise RuntimeError("Invalid editorial configuration") from None


class Fallback(BaseModel):
    """Map values absent from the canonical territory projection."""
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    name: str = Field(min_length=1)
    country_code: str = Field(pattern=r'^[A-Z]{2}$')
    timezone: str
    center: tuple[float, float]
    bounds: tuple[float, float, float, float]
    zoom: int = Field(ge=0, le=19)

    @model_validator(mode='after')
    def valid_map(self):
        """Reject nonfinite, inverted or out-of-world coordinates and unknown zones."""
        validate_bounds(self.bounds)
        lon,lat = self.center
        if not all(math.isfinite(x) for x in self.center) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError('Invalid map centre')
        ZoneInfo(self.timezone)
        return self


class Emergency(BaseModel):
    """One configured phone entry, never inferred for another city."""
    model_config = ConfigDict(extra='forbid')
    number: str = Field(pattern=r'^[0-9 +]{2,24}$')
    label: str = Field(min_length=1,max_length=120)


class Profile(BaseModel):
    """Validated application profile for one territorial directory."""
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)
    territory_code: str = Field(min_length=1,max_length=80)
    fallback: Fallback
    search_extent: tuple[float,float,float,float]
    public_origin: HttpUrl
    emergencies: list[Emergency]
    external_notice: str = Field(min_length=1)

    @model_validator(mode='after')
    def valid_profile(self):
        """Validate the search envelope and a credential-free origin."""
        validate_bounds(self.search_extent)
        if self.public_origin.username or self.public_origin.password or self.public_origin.query or self.public_origin.fragment:
            raise ValueError('Invalid public origin')
        return self


def validate_bounds(bounds):
    """Reject inverted or nonfinite longitude/latitude envelopes."""
    west,south,east,north = bounds
    if not all(math.isfinite(x) for x in bounds) or not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError('Invalid bounds')


def profile(path: Path | None = None) -> Profile:
    """Fail startup safely on missing, ambiguous or invalid trusted configuration."""
    try:
        path = path or Path(os.environ.get('EGI_APP_CONFIG', Path(__file__).with_name('app_profile.yaml')))
        return Profile.model_validate(yaml.load(path.read_text(),Loader=UniqueLoader))
    except Exception:
        raise RuntimeError('Invalid application profile') from None


def resolved(territory: dict | None = None, policy: Profile | None = None) -> dict:
    """Resolve public city settings with canonical territory values taking precedence."""
    policy = policy or profile()
    city = policy.fallback.model_dump(mode='json')
    territory = territory or {}
    city.update({key:territory[source] for key,source in [('name','name'),('country_code','country_code'),('timezone','timezone_name')]
                 if territory.get(source)})
    city['territory_code'] = territory.get('code',policy.territory_code)
    city['boundary'] = territory.get('boundary')
    if city['boundary']:
        def points(value):
            """Walk GeoJSON coordinates without assuming a single polygon ring."""
            if len(value)>=2 and isinstance(value[0],(float,int)):
                yield value
            else:
                for part in value:
                    yield from points(part)
        pairs=list(points(city['boundary']['coordinates']))
        if pairs:
            city['bounds']=[min(x[0] for x in pairs),min(x[1] for x in pairs),max(x[0] for x in pairs),max(x[1] for x in pairs)]
    city.update(search_extent=list(policy.search_extent),public_origin=str(policy.public_origin).rstrip('/'),
                emergencies=[row.model_dump() for row in policy.emergencies],external_notice=policy.external_notice)
    return city


@dataclass(frozen=True)
class Configuration:
    """Own one mode/profile/store selection and private diagnostic destination."""
    policy: Profile
    canonical: bool = False
    local_layers: bool = False
    directory: DirectorySettings | None = None
    error_dir: Path = ROOT / '.local/errors'
    transport_roots: tuple[Path, Path] = (ROOT.parent / '.local/transport', ROOT.parent / '.local/rail')
    osm_root: Path = ROOT.parent / '.local/osm-rail'
    cycle_root: Path = ROOT.parent / '.local/cycleways'
    geocoder_url: str = 'https://nominatim.openstreetmap.org/search'
    rate_file: Path = ROOT.parent / '.local/geocoding/request.lock'
    preview_dsn: str | None = None
    psql: str = '/Library/PostgreSQL/18/bin/psql'
    preview_runtime: Path = ROOT.parent / '.local/preview-db/runtime.json'
    editorial: EditorialSettings | None = None

    @classmethod
    def load(cls):
        """Validate current environment without constructing readers or network clients."""
        mode = os.environ.get('EGI_DATA_MODE', 'preview')
        if mode not in {'canonical', 'preview'}:
            raise RuntimeError('Unsupported directory data mode')
        policy = profile()
        directory = settings() if mode == 'canonical' else None
        if directory:
            directory.territory_code = policy.territory_code
        return cls(policy=policy, canonical=mode == 'canonical',
            local_layers=os.environ.get('EGI_LOCAL_LAYERS', '0') == '1', directory=directory,
            error_dir=Path(os.environ.get('EGI_ERROR_DIR', ROOT / '.local/errors')),
            transport_roots=(Path(os.environ.get('EGI_TRANSPORT_ROOT', ROOT.parent / '.local/transport')),
                             Path(os.environ.get('EGI_RAIL_ROOT', ROOT.parent / '.local/rail'))),
            osm_root=Path(os.environ.get('EGI_OSM_RAIL_ROOT', ROOT.parent / '.local/osm-rail')),
            cycle_root=Path(os.environ.get('EGI_CYCLEWAYS_ROOT', ROOT.parent / '.local/cycleways')),
            geocoder_url=os.environ.get('EGI_GEOCODER_URL', 'https://nominatim.openstreetmap.org/search'),
            rate_file=Path(os.environ.get('EGI_GEOCODER_RATE_FILE', ROOT.parent / '.local/geocoding/request.lock')),
            preview_dsn=os.environ.get('EGI_PREVIEW_DSN'),
            psql=os.environ.get('EGI_PSQL', '/Library/PostgreSQL/18/bin/psql'),
            editorial=editorial_settings())
