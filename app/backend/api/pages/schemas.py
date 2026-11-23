"""Public page selection and health response shapes."""
from pydantic import BaseModel

class PageSelection(BaseModel):
    """Select an existing territory page and its interface language."""
    city_id: int = 1
    lang: str = 'it'

class Health(BaseModel):
    """Describe the selected reader without its private connection details."""
    status: str
    mode: str
    services: int
