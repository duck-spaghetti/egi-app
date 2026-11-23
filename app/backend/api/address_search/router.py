"""Accept the existing coordinate-free address-search request."""
from fastapi import APIRouter, Depends
from .schemas import AddressSearch
from .dependencies import owner
from .service import AddressSearch as Search
router = APIRouter()

@router.post('/api/preview/address-search')
def address_search(body: AddressSearch, module: Search = Depends(owner)):
    """Submit the explicit address query without including it in the URL."""
    return module.search(body.query)
