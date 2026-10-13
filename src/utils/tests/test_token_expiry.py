"""Versioned bootstrap credential lifetime validation."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import unittest
from unittest import mock

from src.utils import token_expiry


class TokenExpiryTests(unittest.TestCase):
    """Reject invalid metadata without treating expiry as a structural error."""

    def test_round_trip_and_expired_metadata_remains_structurally_valid(self):
        with mock.patch('time.time', return_value=1800000000):
            lifetime = token_expiry.TokenExpiry.issue(86400, 1)
        with mock.patch('time.time', return_value=1900000000):
            self.assertEqual(token_expiry.TokenExpiry.decode(lifetime.encode()), lifetime)

    def test_malformed_contract_is_rejected(self):
        valid = json.loads(token_expiry.TokenExpiry(1800000000, 1800086400, 1).encode())
        cases = [
            {'version': True}, {'version': 2}, {'generation': True}, {'generation': 0},
            {'issued_at': '2027-01-01T00:00:00'}, {'expires_at': '2027-01-01T00:00:00+01:00'},
            {'expires_at': valid['issued_at']}, {'issued_at': None},
            {'expires_at': '2099-01-01T00:00:00+00:00'}, {'extra': 1},
        ]
        for updates in cases:
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                token_expiry.TokenExpiry.decode(json.dumps(valid | updates).encode())
        for raw in (b'null', b'[]', b'{}', b'not-json', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                token_expiry.TokenExpiry.decode(raw)

    def test_invalid_issuance_policy_is_rejected(self):
        for lifetime, generation in ((True, 1), (60, True), (59, 1), (604801, 1), (60, 0)):
            with self.subTest(lifetime=lifetime, generation=generation):
                with self.assertRaises(ValueError):
                    token_expiry.TokenExpiry.issue(lifetime, generation)


if __name__ == '__main__':
    unittest.main()
