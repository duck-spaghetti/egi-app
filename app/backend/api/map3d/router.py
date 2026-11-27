"""Serve files of the active 3D data set version with Range support and long caching."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, JSONResponse
from .service import Map3d

router = APIRouter()
TYPES = {'.pmtiles': 'application/vnd.pmtiles', '.geojson': 'application/geo+json', '.pbf': 'application/x-protobuf'}
# A version never changes: its files may be cached for a year.
IMMUTABLE = 'public, max-age=31536000, immutable'


def owner(request: Request) -> Map3d:
    """This application's 3D data set reader."""
    return request.app.state.resources.map3d


@router.get('/map3d/active')
def active(module: Map3d = Depends(owner)):
    """Availability and base URL of the active version (no-store)."""
    summary = module.summary()
    return JSONResponse({'availability': 'available', **summary} if summary else {'availability': 'unavailable'}, headers={'Cache-Control': 'no-store'})


@router.get('/map3d/{version}/{name:path}')
def data_file(version: str, name: str, module: Map3d = Depends(owner)):
    """One file of the active version; 404 for any other version or unlisted path."""
    path = module.file(version, name)
    if path is None:
        return JSONResponse({'error': 'not_found'}, status_code=404)
    media = next((v for k, v in TYPES.items() if name.endswith(k)), 'application/octet-stream')
    headers = {'Cache-Control': IMMUTABLE}
    if name.endswith('.json.gz'):
        media = 'application/json'
        headers['Content-Encoding'] = 'gzip'
    return FileResponse(path, media_type=media, headers=headers)
