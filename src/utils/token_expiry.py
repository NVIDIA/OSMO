"""Persisted lifetime of a finite Secret-backed bootstrap credential."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import dataclasses
import datetime
import json
import time

METADATA_KEY = 'token-metadata'
MIN_LIFETIME = 60
MAX_LIFETIME = 7 * 24 * 60 * 60


@dataclasses.dataclass(frozen=True)
class TokenExpiry:
    """A deadline that survives reconciliation and is renewed only with new bytes."""

    issued_at: int
    expires_at: int
    generation: int

    @classmethod
    def issue(cls, lifetime: int, generation: int) -> 'TokenExpiry':
        if (not isinstance(lifetime, int) or isinstance(lifetime, bool)
                or not isinstance(generation, int) or isinstance(generation, bool)
                or not MIN_LIFETIME <= lifetime <= MAX_LIFETIME or generation < 1):
            raise ValueError('Invalid bootstrap token lifetime or generation')
        now = int(time.time())
        return cls(now, now + lifetime, generation)

    def encode(self) -> bytes:
        def timestamp(value: int) -> str:
            return datetime.datetime.fromtimestamp(value, datetime.timezone.utc).isoformat()
        return json.dumps({
            'version': 1, 'issued_at': timestamp(self.issued_at),
            'expires_at': timestamp(self.expires_at), 'generation': self.generation,
        }, sort_keys=True).encode('utf-8')

    @classmethod
    def decode(cls, raw: bytes) -> 'TokenExpiry':
        try:
            values = json.loads(raw)
            if (not isinstance(values, dict)
                    or set(values) != {'version', 'issued_at', 'expires_at', 'generation'}
                    or not isinstance(values['version'], int) or isinstance(values['version'], bool)
                    or values['version'] != 1
                    or not isinstance(values['generation'], int)
                    or isinstance(values['generation'], bool) or values['generation'] < 1):
                raise ValueError()
            timestamps = []
            for name in ('issued_at', 'expires_at'):
                value = values[name]
                if not isinstance(value, str):
                    raise ValueError()
                parsed = datetime.datetime.fromisoformat(value)
                if parsed.utcoffset() != datetime.timedelta(0) or parsed.microsecond:
                    raise ValueError()
                timestamps.append(int(parsed.timestamp()))
            issued_at, expires_at = timestamps[0], timestamps[1]
            if issued_at <= 0 or not MIN_LIFETIME <= expires_at - issued_at <= MAX_LIFETIME:
                raise ValueError()
            return cls(issued_at, expires_at, values['generation'])
        except (ValueError, TypeError, OverflowError, UnicodeError) as error:
            raise ValueError('Invalid bootstrap token expiry metadata') from error
