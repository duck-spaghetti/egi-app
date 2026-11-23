"""Validate one city profile and resolve only safe public bootstrap values.

Territory fields are canonical; map/search/emergency/domain fallbacks are explicit
application configuration. No secret or private path enters the resolved profile.
"""
from functools import lru_cache
import math
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator
import yaml
from .directory_db import UniqueLoader


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


@lru_cache(maxsize=1)
def profile() -> Profile:
    """Fail startup safely on missing, ambiguous or invalid trusted configuration."""
    try:
        path = Path(os.environ.get('EGI_APP_CONFIG', Path(__file__).with_name('app_profile.yaml')))
        return Profile.model_validate(yaml.load(path.read_text(),Loader=UniqueLoader))
    except Exception:
        raise RuntimeError('Invalid application profile') from None


def resolved(territory: dict | None = None) -> dict:
    """Resolve public city settings with canonical territory values taking precedence."""
    policy = profile()
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
