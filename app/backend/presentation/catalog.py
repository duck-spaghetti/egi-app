"""Look up server-rendered text in the UI catalogs, falling back to Italian.

The catalogs under `translations/` are the single source of visible text. New keys
start in Italian (B3, Q1); another language without a key shows the Italian text.
"""
import json
from pathlib import Path


class Catalog:
    """Own the loaded catalogs of one application instance."""

    def __init__(self, root: Path, fallback: str = 'it'):
        """Load every `<language>.json` once; a missing file is simply absent."""
        self.fallback = fallback
        self.languages = {path.stem: json.loads(path.read_text()) for path in sorted(root.glob('*.json'))}

    def text(self, key: str, language: str = 'it', **values) -> str:
        """Return the dotted `key` in `language`, else Italian, formatted with `values`.

        An unknown key returns the key itself, so a missing string is visible, not silent.
        """
        for code in (language, self.fallback):
            node = self.languages.get(code, {})
            for part in key.split('.'):
                node = node.get(part) if isinstance(node, dict) else None
            if isinstance(node, str):
                return node.format(**values) if values else node
        return key
