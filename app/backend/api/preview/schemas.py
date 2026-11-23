"""Existing preview selection shapes; no canonical publication claim."""
from pydantic import BaseModel, Field

class PreviewSelection(BaseModel):
    """Select the retained source preview and its placement policy."""
    area_id: int = 1
    language: str = 'it'
    limit: int = Field(default=2000, ge=1, le=5000)
    include_unplaced: bool = False
