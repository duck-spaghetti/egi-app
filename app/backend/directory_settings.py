"""Validate the selected canonical backend and its private connection configuration."""

from pathlib import Path
from typing import Literal

from pydantic import SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict


class DirectorySettings(BaseSettings):
    """Configuration for one PostgreSQL public-directory reader."""

    model_config = SettingsConfigDict(env_prefix="EGI_", hide_input_in_errors=True)
    db_backend: Literal["postgres"] = "postgres"
    database_url: SecretStr
    territory_code: str = "roma"
    query_catalogue: Path = Path(__file__).with_name("public_queries.yaml")


def settings() -> DirectorySettings:
    """Fail startup without echoing configuration or secret-bearing validation inputs."""
    try:
        result = DirectorySettings()
        if not result.database_url.get_secret_value().strip() or not result.territory_code.strip():
            raise ValueError("empty required setting")
        return result
    except (ValidationError, ValueError):
        raise RuntimeError("Invalid canonical directory configuration") from None
