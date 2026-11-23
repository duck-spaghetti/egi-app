"""Own the process-wide selected reader and trusted template/configuration resources."""
import os
from pathlib import Path
from fastapi.templating import Jinja2Templates
from .app_profile import profile
from .subjects import PostgresSubjectSource
from .directory_db import Db
from .directory_settings import settings

ROOT=Path(__file__).resolve().parents[2]
PROFILE=profile()
DATA_MODE=os.environ.get('EGI_DATA_MODE','preview')
if DATA_MODE not in {'canonical','preview'}:
    raise RuntimeError('Unsupported directory data mode')
CANONICAL=DATA_MODE=='canonical'
LOCAL_LAYERS=os.environ.get('EGI_LOCAL_LAYERS','0')=='1'
configuration=settings() if CANONICAL else None
if configuration:
    configuration.territory_code=PROFILE.territory_code
DIRECTORY=Db(configuration) if configuration else None
SUBJECT_SOURCE=PostgresSubjectSource()
templates=Jinja2Templates(directory=ROOT/'app/frontend/templates')
