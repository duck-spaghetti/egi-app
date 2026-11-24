"""Preserved public discovery query and response meanings."""
from pydantic import BaseModel, Field

class Discovery(BaseModel):
    """Select language and the bounded number of existing public cards."""
    area_id: int = 1
    language: str = Field(default='it', max_length=16)
    limit: int = Field(default=2000, ge=1, le=5000)
