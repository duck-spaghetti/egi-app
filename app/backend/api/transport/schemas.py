"""Existing bounded request shapes; territorial policy is injected into behavior."""
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Origin(BaseModel):
    """An explicitly selected in-memory origin within the configured search area."""
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    lat: float
    lon: float

class Viewport(BaseModel):
    """A bounded map viewport submitted without coordinates in its URL."""
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    west: float
    south: float
    east: float
    north: float
    zoom: int = Field(ge=0, le=19)

class TransportViewport(Viewport):
    """A viewport with the existing comma-separated mode/route selection."""
    modes: str = Field(default='metro,rail,tram,bus', max_length=80)
    routes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode='after')
    def selections(self):
        """Reject unknown transport modes and excessive route selection."""
        if not set(self.modes.split(',')) <= {'metro', 'rail', 'tram', 'bus'}:
            raise ValueError('Invalid modes')
        if self.routes is not None and (not 0 < len({x for x in self.routes.split(',') if x}) <= 80):
            raise ValueError('Invalid routes')
        return self
