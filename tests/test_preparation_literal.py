"""Verify exact source selections across textarea normalization without any writes."""
import base64
import hashlib
import unittest

from app.backend.api.preparations.http import Failure
from app.backend.api.preparations.literal import prepared_fact, selection_span


class LiteralSelectionTests(unittest.TestCase):
    """A generated draft fragment always points back to exact retained bytes."""

    def test_bom_emoji_crlf_and_cr_offsets_are_original(self):
        """LF-view selection maps to original code points without losing hash identity."""
        original = '\ufeff🧭\r\nAssociazione Alfa\rMensa'.encode()
        retained = {'original_base64': base64.b64encode(original).decode(), 'sha256': hashlib.sha256(original).hexdigest()}
        body = {'input_id': '10000000-0000-0000-0000-000000000001', 'kind': 'organization_name', 'subject': 'service',
                'selection': {'start': 2, 'end': 19}}
        result = prepared_fact(retained, body)
        self.assertEqual(result['fact']['source_value'], 'Associazione Alfa')
        self.assertEqual(result['evidence']['span'], {'start': 3, 'end': 20})
        self.assertEqual(result['evidence']['input_hash'], retained['sha256'])
        self.assertEqual(selection_span(original.decode('utf-8-sig'), {'start': 0, 'end': 20}), (0, 21))

    def test_invalid_empty_and_boolean_boundaries_fail(self):
        """Invalid selections cannot become an invented quotation."""
        for selection in ({'start': True, 'end': 2}, {'start': 0, 'end': 0}, {'start': -1, 'end': 1},
                          {'start': 0, 'end': 4}, {'start': 0, 'end': 1, 'extra': 1}):
            with self.assertRaises(Failure):
                selection_span('abc', selection)
