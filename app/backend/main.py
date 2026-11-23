"""Compose selected routers, shared readers, privacy middleware and resource lifecycle."""
from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .runtime import ROOT, CANONICAL, LOCAL_LAYERS, DIRECTORY
from .diagnostics import DIAGNOSTICS, safe_response
from .directory_db import DirectoryUnavailable
from .page_routes import router as pages
from .search_routes import router as search


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Expire old diagnostics before opening and own the running cleanup task."""
    logging.getLogger('uvicorn.access').disabled=True
    DIAGNOSTICS.prune()
    cleanup=asyncio.create_task(DIAGNOSTICS.cleanup())
    try:
        yield
    finally:
        cleanup.cancel()
        try:
            await cleanup
        except asyncio.CancelledError:
            pass


app=FastAPI(title='EGI local directory',version='0.2.0',lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','[::1]','testserver'])
app.add_middleware(GZipMiddleware,minimum_size=1000,compresslevel=5)
app.mount('/static',StaticFiles(directory=ROOT/'app/frontend/static'),name='static')
app.mount('/translations',StaticFiles(directory=ROOT/'translations'),name='translations')
app.include_router(pages)
app.include_router(search)
if CANONICAL:
    from .directory_routes import router as directory_router
    app.include_router(directory_router(DIRECTORY))
else:
    from .preview_routes import router as preview
    app.include_router(preview)
if not CANONICAL or LOCAL_LAYERS:
    from .local_routes import router as local
    app.include_router(local)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    """Discard input-bearing validation detail before it reaches a response or log."""
    return safe_response(422,'invalid_request')


@app.exception_handler(DirectoryUnavailable)
async def unavailable_directory(request: Request, error: DirectoryUnavailable):
    """Expose a safe store failure without its connection configuration."""
    return safe_response(503,'directory_unavailable')


@app.exception_handler(HTTPException)
async def expected_error(request: Request, error: HTTPException):
    """Map HTTP failures without echoing exception detail or user parameters.

    Only the address search depends on an upstream provider; other 503s are the
    preview store, and app-raised 422s are invalid requests.
    """
    if error.status_code == 422:
        code = 'invalid_request'
    elif request.url.path == '/api/preview/address-search':
        code = 'upstream_unavailable'
    else:
        code = 'directory_unavailable'
    return safe_response(error.status_code,code)


@app.middleware('http')
async def private_responses(request: Request, call_next):
    """Contain unexpected errors and mark every dynamic response with its data boundary."""
    try:
        response=await call_next(request)
    except Exception as error:
        response=safe_response(500,'internal_error',error)
    response.headers['Cache-Control']='no-store'
    response.headers['X-EGI-Data-Status']='approved-canonical-local' if CANONICAL else 'unreviewed-source-preview'
    return response
