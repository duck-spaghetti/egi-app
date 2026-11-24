"""Safely parse YAML and validate named PostgreSQL directory reads."""
from pathlib import Path
import yaml

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
