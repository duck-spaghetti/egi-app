"""Run the Community queue as a separate process with an isolated worker login.

load_settings reads only explicit runtime settings or the approved local .env.
main polls durable jobs with safe status-only output; it installs no scheduler,
creates no database roles/configurations and makes no calls merely on import.
"""
import argparse
from importlib.metadata import PackageNotFoundError, version
import json
import signal
from threading import Event

from pydantic import Field, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from ...config import ROOT
from .interpretation.queue import JobQueue
from .interpretation.runner import Worker


class WorkerSettings(BaseSettings):
    """Keep database/provider secrets separate from public and editorial logins."""

    model_config = SettingsConfigDict(env_file=ROOT/'.env',extra='ignore',hide_input_in_errors=True)
    database_url: SecretStr = Field(validation_alias='EGI_PREPARATION_WORKER_DATABASE_URL',min_length=1)
    api_key: SecretStr = Field(validation_alias='OPENAI_API_KEY',min_length=1)


def load_settings() -> WorkerSettings:
    """Refuse missing settings or a wrong Reviewer build without echoing inputs."""
    try:
        if version('egi-reviewer') != '0.5.1':
            raise ValueError('reviewer_version')
        return WorkerSettings()
    except (ValidationError,ValueError,PackageNotFoundError):
        raise RuntimeError('Invalid Community worker configuration') from None


def main(argv=None) -> int:
    """Poll one job at a time; signals stop after the current bounded exchange."""
    parser = argparse.ArgumentParser(description='Process durable Community interpretation jobs')
    parser.add_argument('--once',action='store_true',help='Process at most one queued job')
    options = parser.parse_args(argv)
    try:
        settings = load_settings()
    except RuntimeError:
        print(json.dumps({'code':'worker_configuration_invalid'}))
        return 2
    stopped = Event()

    def stop(*_):
        """Request graceful shutdown without logging credentials or private input."""
        stopped.set()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,stop)
    worker = Worker(JobQueue(settings.database_url.get_secret_value()),settings.api_key)
    while not stopped.is_set():
        try:
            result = worker.run_once()
            if result is not None:
                print(json.dumps({'code':'job_processed','state':result.get('state','unknown')}),flush=True)
        except Exception:
            print(json.dumps({'code':'worker_operation_unavailable'}),flush=True)
            if options.once:
                return 1
        if options.once:
            break
        stopped.wait(1)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
