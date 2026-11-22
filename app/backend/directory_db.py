"""Load named public reads through one read-only PostgreSQL facade and bounded cache.

Catalogue validation rejects duplicate keys before overwrites. Each read owns one
repeatable-read connection/transaction. Core directory snapshots cache for at most
60 seconds; supplements are read every time because review/link changes need not
advance the public sequence. Database errors never become a successful empty map.
"""

import copy
from datetime import datetime, timezone
import threading
import time
from pathlib import Path
from typing import Any

import psycopg
import yaml
from psycopg.rows import dict_row

from .directory_settings import DirectorySettings


class DirectoryUnavailable(RuntimeError):
    """The selected public store could not complete a read."""


class UniqueLoader(yaml.SafeLoader):
    """Reject duplicate YAML keys while retaining SafeLoader's type restrictions."""


def unique_mapping(loader: UniqueLoader, node: yaml.MappingNode) -> dict:
    """Construct a mapping without silently overwriting a repeated key."""
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=True)
        if not isinstance(key, str) or key in result:
            raise ValueError("Invalid or duplicate catalogue key")
        result[key] = loader.construct_object(value_node, deep=True)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def catalogue(path: Path) -> dict[str, str]:
    """Validate required named operations and the selected PostgreSQL coverage."""
    try:
        data = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueLoader)
        if not isinstance(data, dict) or set(data) != {"format", "queries"} or data["format"] != "egi-public-queries/1":
            raise ValueError("Invalid catalogue envelope")
        queries = data["queries"]
        if not isinstance(queries, dict) or set(queries) != {"sequence", "snapshot", "supplements"}:
            raise ValueError("Required public queries missing")
        result = {}
        for name, backends in queries.items():
            if not isinstance(backends, dict) or set(backends) != {"postgres"}:
                raise ValueError("Invalid backend coverage")
            sql = backends["postgres"]
            if not isinstance(sql, str) or not sql.strip():
                raise ValueError("Empty query")
            result[name] = sql
        return result
    except (OSError, ValueError, yaml.YAMLError):
        raise RuntimeError("Invalid public query catalogue") from None


class Db:
    """Own the configured public reads, connection lifetime and per-language cache."""

    def __init__(self, configuration: DirectorySettings):
        """Validate the catalogue before any database connection is opened."""
        self.configuration = configuration
        self.queries = catalogue(configuration.query_catalogue)
        self.cache: dict[str, tuple[float, int, dict]] = {}
        self.lock = threading.Lock()

    def snapshot(self, language: str = "it") -> dict[str, Any]:
        """Read one coherent public snapshot with fresh, independently guarded supplements."""
        try:
            with self.lock, psycopg.connect(self.configuration.database_url.get_secret_value(),
                                            connect_timeout=3, row_factory=dict_row) as connection:
                connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
                connection.read_only = True
                connection.execute("SELECT set_config('statement_timeout','10000',true)")
                params = {"language": language, "territory": self.configuration.territory_code}
                sequence = connection.execute(self.queries["sequence"]).fetchone()["value"]
                cached = self.cache.get(language)
                now = time.monotonic()
                if cached and now - cached[0] < 60 and cached[1] == sequence and not transition_passed(cached[2]):
                    snapshot = copy.deepcopy(cached[2])
                else:
                    row = connection.execute(self.queries["snapshot"], params).fetchone()
                    if not row or row["value"] is None:
                        raise DirectoryUnavailable("Configured territory is not public")
                    snapshot = row["value"]
                    self.cache[language] = (now, sequence, copy.deepcopy(snapshot))
                    if len(self.cache) > 8:
                        self.cache.pop(next(iter(self.cache)))
                snapshot["supplements"] = connection.execute(self.queries["supplements"], params).fetchone()["value"]
                return snapshot
        except psycopg.Error:
            raise DirectoryUnavailable("Canonical directory unavailable") from None


def transition_passed(snapshot: dict) -> bool:
    """Expire cached opening data at the earliest declared canonical status transition."""
    now = datetime.now(timezone.utc)
    return any(datetime.fromisoformat(value.replace("Z", "+00:00")) <= now
               for service in snapshot.get("services", [])
               if (value := (service.get("opening") or {}).get("next_transition_at")))
