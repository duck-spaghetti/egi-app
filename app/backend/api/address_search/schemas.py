"""Existing bounded request shapes; territorial policy is injected into behavior."""
from pydantic import BaseModel, ConfigDict, Field, model_validator

class AddressSearch(BaseModel):
    """Submit an address only in a bounded request body."""
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    query: str = Field(min_length=3, max_length=200)
