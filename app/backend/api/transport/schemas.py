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


class VehicleViewport(BaseModel):
    """Bound vehicle requests in a POST body; never place visitor selections in URLs."""
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)
    lines: list[str] = Field(default_factory=list, max_length=80)

    @model_validator(mode='after')
    def bounded(self):
        """Require an ordered viewport no wider/taller than 0.15 degrees and short codes."""
        if not 0 < self.east-self.west <= .15 or not 0 < self.north-self.south <= .15:
            raise ValueError('Invalid area')
        if any(not line or len(line)>32 for line in self.lines):
            raise ValueError('Invalid lines')
        return self
