"""Prepare an unsaved literal fragment from an authorized exact source selection.

The textarea uses LF-normalized newlines and Unicode code points. Evidence maps
back to the immutable BOM-decoded original; ordinary expected-version save owns
all persistence, receipts, permissions and selective submission.
"""
import base64
from uuid import uuid4

from .http import Failure


def selection_span(original: str, selection: dict) -> tuple[int, int]:
    """Map LF-view boundaries back to original CRLF/CR code-point boundaries."""
    if not isinstance(selection, dict) or selection.keys() != {'start', 'end'} or any(type(value) is not int for value in selection.values()):
        raise Failure(422, 'invalid_source_selection')
    boundaries, cursor = [0], 0
    while cursor < len(original):
        cursor += 2 if original[cursor:cursor + 2] == '\r\n' else 1
        boundaries.append(cursor)
    start, end = selection['start'], selection['end']
    if not 0 <= start < end < len(boundaries):
        raise Failure(422, 'invalid_source_selection')
    return boundaries[start], boundaries[end]


def prepared_fact(retained: dict, body: dict) -> dict:
    """Mint an unsaved fact/locator for a real retained selection, not free text."""
    if body['kind'] not in ('organization_name', 'category_label') or body['subject'] not in ('service', 'location'):
        raise Failure(422, 'invalid_source_fact')
    original = base64.b64decode(retained['original_base64']).decode('utf-8-sig')
    start, end = selection_span(original, body['selection'])
    quote = original[start:end]
    if not quote.strip():
        raise Failure(422, 'invalid_source_selection')
    path = '/source_facts/0/source_value'
    return {'fact': {'fact_id': str(uuid4()), 'kind': body['kind'], 'subject': body['subject'], 'source_value': quote, 'value': quote},
            'evidence': {'id': str(uuid4()), 'path': path, 'kind': 'stated', 'input_id': str(body['input_id']),
                         'input_hash': retained['sha256'], 'quote': quote, 'span': {'start': start, 'end': end}},
            'field_origins': {path: {'state': 'manual'}, '/source_facts/0/value': {'state': 'manual'}}}
