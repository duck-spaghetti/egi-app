"""Existing bounded request shapes; territorial policy is injected into behavior."""
from pydantic import BaseModel, ConfigDict, Field, model_validator

class Viewport(BaseModel):
    """A bounded map viewport submitted without coordinates in its URL."""
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    west: float
    south: float
    east: float
    north: float
    zoom: int = Field(ge=0, le=19)
