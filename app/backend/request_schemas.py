"""Validate privacy-sensitive POST bodies before local services receive them."""
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .app_profile import profile, validate_bounds


class AddressSearch(BaseModel):
    """Submit an address only in a bounded request body."""
    model_config = ConfigDict(extra='forbid',str_strip_whitespace=True)
    query: str = Field(min_length=3,max_length=200)


class Origin(BaseModel):
    """An explicitly selected in-memory origin within the configured search area."""
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
    lat: float
    lon: float

    @model_validator(mode='after')
    def in_area(self):
        """Reject points beyond the configured search extent."""
        w,s,e,n=profile().search_extent
        if not (w<=self.lon<=e and s<=self.lat<=n):
            raise ValueError('Origin outside configured area')
        return self


class Viewport(BaseModel):
    """A bounded map viewport submitted without coordinates in its URL."""
    model_config = ConfigDict(extra='forbid',allow_inf_nan=False)
    west: float
    south: float
    east: float
    north: float
    zoom: int = Field(ge=0,le=19)

    @model_validator(mode='after')
    def in_area(self):
        """Reject inverted, nonfinite or unbounded viewport requests."""
        validate_bounds((self.west,self.south,self.east,self.north))
        w,s,e,n=profile().search_extent
        if not (w<=self.west<self.east<=e and s<=self.south<self.north<=n):
            raise ValueError('Viewport outside configured area')
        return self


class TransportViewport(Viewport):
    """A viewport with the existing comma-separated mode/route selection."""
    modes: str = Field(default='metro,rail,tram,bus',max_length=80)
    routes: str | None = Field(default=None,max_length=2000)

    @model_validator(mode='after')
    def selections(self):
        """Reject unknown transport modes and excessive route selection."""
        if not set(self.modes.split(',')) <= {'metro','rail','tram','bus'}:
            raise ValueError('Invalid modes')
        if self.routes is not None and not 0<len({x for x in self.routes.split(',') if x})<=80:
            raise ValueError('Invalid routes')
        return self
