"""Compose the selected endpoint families and own each application's resources."""
import asyncio
from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .config import Configuration, ROOT
from .dependencies import Resources
from .diagnostics import safe_response
from .exceptions import ApplicationError
from .api.moderation.desk import Refused
from fastapi.responses import RedirectResponse

# Database refusals that have their own moderation message; others read "refused".
MESSAGE_CODES = {'admin_required', 'last_admin', 'account_not_active', 'account_not_reissuable',
                 'display_name_required', 'second_factor_required', 'sign_in_refused', 'already_in_use'}


def create_app(configuration=None, overrides=None):
    """Create an isolated app; validate and construct dependencies in its lifespan."""
    @asynccontextmanager
    async def lifespan(application):
        """Own validation, selected readers and diagnostic/cache expiry for this run."""
        cfg = configuration or Configuration.load()
        resources = Resources.create(cfg, overrides)
        application.state.resources = resources
        logging.getLogger('uvicorn.access').disabled = True
        resources.diagnostics.prune()
        cleanup = asyncio.create_task(resources.diagnostics.cleanup(resources.geocoder.expire_cache))
        mount_selected(application, cfg)
        try:
            yield
        finally:
            cleanup.cancel()
            try:
                await cleanup
            except asyncio.CancelledError:
                pass
            resources.close()

    application = FastAPI(title='EGI local directory', version='0.2.0', lifespan=lifespan)
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]', 'testserver'])
    application.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
    application.mount('/static', StaticFiles(directory=ROOT / 'app/frontend/static'), name='static')
    application.mount('/translations', StaticFiles(directory=ROOT / 'translations'), name='translations')

    def respond(request, status, code, error=None):
        """Use only the requesting application's safe diagnostic writer."""
        return safe_response(status, code, error, request.app.state.resources.diagnostics)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        """Discard all input-bearing validation diagnostics."""
        return respond(request, 422, 'invalid_request')

    @application.exception_handler(ApplicationError)
    async def expected_failure(request: Request, error: ApplicationError):
        """Translate feature failures without exposing source or request details."""
        return respond(request, error.status, 'invalid_request' if error.status == 422 else error.code)

    @application.exception_handler(HTTPException)
    async def http_failure(request: Request, error: HTTPException):
        """Retain status codes while withholding HTTP exception contents."""
        return respond(request, error.status_code, 'invalid_request' if error.status_code == 422 else 'directory_unavailable')

    @application.exception_handler(Refused)
    async def refused(request: Request, error: Refused):
        """A database refusal on a moderation page: an expired session goes back to sign-in."""
        module = request.app.state.resources.moderation
        if error.code == 'session_invalid':
            response = RedirectResponse('/moderazione', status_code=303)
            module.end_session(response)
            return response
        return module.render(request, 'message.html', status=403 if error.code.endswith('required') else 400,
                             message=error.code if error.code in MESSAGE_CODES else 'refused')

    @application.middleware('http')
    async def private_responses(request: Request, call_next):
        """Contain unexpected failures and identify the selected data mode."""
        try:
            response = await call_next(request)
        except Exception as error:
            response = respond(request, 500, 'internal_error', error)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-EGI-Data-Status'] = ('approved-canonical-local' if request.app.state.resources.configuration.canonical else 'unreviewed-source-preview')
        return response
    return application


def mount_selected(application, configuration):
    """Install only the real endpoint families selected for this app, once."""
    if getattr(application.state, 'mounted', False):
        return
    from .api.pages.router import router as pages
    from .api.address_search.router import router as search
    from .api.contribute.router import router as contribute
    application.include_router(pages)
    application.include_router(contribute)
    application.include_router(search)
    if configuration.canonical:
        from .api.directory.router import router as directory
        application.include_router(directory)
    else:
        from .api.preview.router import router as preview
        application.include_router(preview)
    if configuration.editorial:
        from .api.moderation.router import router as moderation
        application.include_router(moderation)
        from .api.preparations.router import router as preparations
        application.include_router(preparations)
    if not configuration.canonical or configuration.local_layers:
        from .api.transport.router import router as transport
        from .api.cycleways.router import router as cycleways
        application.include_router(transport)
        application.include_router(cycleways)
    application.state.mounted = True


app = create_app()
