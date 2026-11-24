"""Keep allowlisted diagnostics with no request data and an explicit 14-day expiry.

Each event owns a small private file and expiry; startup/lifespan cleanup removes
only this writer's records. Exceptions are never serialized or passed to a logger.
"""
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
import uuid

from fastapi.responses import JSONResponse

RETENTION = 14*86400
EVENTS = {'invalid_request','directory_unavailable','upstream_unavailable','internal_error'}


class Diagnostics:
    """Write only safe event codes and expire records before serving and while running."""

    def __init__(self, directory: Path):
        """Select a private directory without creating it on module import."""
        self.directory = directory

    def record(self, code: str, error: Exception | None = None, now: float | None = None) -> str:
        """Return an opaque diagnostic ID without retaining exception or request content."""
        identifier = uuid.uuid4().hex
        now = time.time() if now is None else now
        location = None
        if error and error.__traceback__:
            traceback = error.__traceback__
            while traceback.tb_next:
                traceback = traceback.tb_next
            location = {'file':Path(traceback.tb_frame.f_code.co_filename).name,'line':traceback.tb_lineno}
        body = {'id':identifier,'at':datetime.fromtimestamp(now,timezone.utc).isoformat(),
                'expires_at':now+RETENTION,'severity':'error','code':code if code in EVENTS else 'internal_error',
                'location':location}
        try:
            self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            os.chmod(self.directory,0o700)
            path=self.directory/(identifier+'.json')
            with path.open('x',encoding='utf-8') as stream:
                os.chmod(path,0o600)
                json.dump(body,stream)
        except OSError:
            # A diagnostic-store failure must not expose an exception through a fallback logger.
            pass
        return identifier

    def prune(self, now: float | None = None) -> float:
        """Delete expired owned events and return the next cleanup delay."""
        now = time.time() if now is None else now
        next_expiry = now+60
        if self.directory.is_dir():
            for path in self.directory.glob('*.json'):
                if path.is_symlink() or not re.fullmatch(r'[a-f0-9]{32}\.json',path.name):
                    continue
                try:
                    record=json.loads(path.read_text())
                    expiry=float(record['expires_at'])
                    if expiry<=now:
                        path.unlink()
                    else:
                        next_expiry=min(next_expiry,expiry)
                except (OSError,ValueError,KeyError,TypeError):
                    continue
        return max(0.01,next_expiry-now)

    async def cleanup(self, expire=lambda: None):
        """Run application-owned expiry without changing any installed scheduler."""
        while True:
            expire()
            await asyncio.sleep(self.prune())



def safe_response(status: int, code: str, error: Exception | None = None, diagnostics: Diagnostics | None = None) -> JSONResponse:
    """Return only a fixed message and a fresh opaque reference to safe diagnostics."""
    messages={422:'Richiesta non valida',503:'Servizio temporaneamente non disponibile',500:'Errore temporaneo'}
    if status not in messages:
        return JSONResponse({'detail':'Risorsa non disponibile'},status_code=status)
    identifier=diagnostics.record(code,error)
    return JSONResponse({'detail':messages[status],'diagnostic_id':identifier},status_code=status)
