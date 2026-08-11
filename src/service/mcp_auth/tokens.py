"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import base64
import json
import secrets
import time
from typing import Any

from jwcrypto import jwk  # type: ignore
import jwt  # type: ignore

from src.service.mcp_auth import models


class AccessTokenIssuer:
    """Issue OSMO MCP access tokens and expose their public verification keys."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        active_kid: str,
        keys: dict[str, jwk.JWK],
        access_token_ttl_seconds: int,
    ) -> None:
        if active_kid not in keys:
            raise ValueError('active_kid does not reference a configured signing key')
        if access_token_ttl_seconds <= 0:
            raise ValueError('access token TTL must be positive')
        try:
            active_private_key = keys[active_kid].export_to_pem(
                private_key=True,
                password=None,
            )
        except Exception as error:  # pylint: disable=broad-exception-caught
            raise ValueError('active signing JWK must contain an RSA private key') from error

        self._issuer = issuer
        self._audience = audience
        self._active_kid = active_kid
        self._active_private_key = active_private_key
        self._access_token_ttl_seconds = access_token_ttl_seconds
        self._public_keys = [
            json.loads(signing_key.export_public())
            for signing_key in keys.values()
        ]

    @classmethod
    def from_jwk_file(
        cls,
        path: str,
        *,
        issuer: str,
        audience: str,
        access_token_ttl_seconds: int,
    ) -> 'AccessTokenIssuer':
        """Load either one private JWK or an active-key JWK set from disk."""
        with open(path, encoding='utf-8') as key_file:
            document = json.load(key_file)
        if not isinstance(document, dict):
            raise ValueError('signing JWK file must contain a JSON object')

        if 'keys' in document:
            key_documents = document.get('keys')
            active_kid = document.get('active_kid')
            if not isinstance(key_documents, list) or not isinstance(active_kid, str):
                raise ValueError('JWK set requires keys and active_kid')
        else:
            key_documents = [document]
            active_kid = document.get('kid')
            if not isinstance(active_kid, str):
                raise ValueError('signing JWK requires a non-empty kid')

        keys: dict[str, jwk.JWK] = {}
        for key_document in key_documents:
            if not isinstance(key_document, dict):
                raise ValueError('each signing key must be a JSON object')
            kid = key_document.get('kid')
            if not isinstance(kid, str) or not kid or kid in keys:
                raise ValueError('each signing key requires a unique non-empty kid')
            if key_document.get('kty') != 'RSA':
                raise ValueError('only RSA signing JWKs are supported')
            modulus = key_document.get('n')
            if not isinstance(modulus, str) or _rsa_modulus_bits(modulus) < 2048:
                raise ValueError('RSA signing JWK modulus must contain at least 2048 bits')
            if key_document.get('alg', 'RS256') != 'RS256':
                raise ValueError('signing JWK alg must be RS256')
            if key_document.get('use', 'sig') != 'sig':
                raise ValueError('signing JWK use must be sig')
            keys[kid] = jwk.JWK.from_json(json.dumps(key_document))

        return cls(
            issuer=issuer,
            audience=audience,
            active_kid=active_kid,
            keys=keys,
            access_token_ttl_seconds=access_token_ttl_seconds,
        )

    @property
    def access_token_ttl_seconds(self) -> int:
        return self._access_token_ttl_seconds

    def jwks(self) -> dict[str, list[dict[str, Any]]]:
        """Return all active and rollover public keys."""
        return {'keys': self._public_keys}

    def issue(
        self,
        identity: models.BrokerIdentity,
        *,
        client_id: str,
        scope: str,
        now: int | None = None,
    ) -> str:
        """Issue a short-lived bearer JWT for the exact MCP audience."""
        issued_at = int(time.time()) if now is None else now
        claims = {
            'iss': self._issuer,
            'aud': self._audience,
            'sub': identity.subject,
            'preferred_username': identity.username,
            'unique_name': identity.username,
            'roles': list(identity.roles),
            'scope': scope,
            'client_id': client_id,
            'azp': client_id,
            'iat': issued_at,
            'nbf': issued_at,
            'exp': issued_at + self._access_token_ttl_seconds,
            'jti': secrets.token_urlsafe(24),
        }
        return jwt.encode(
            claims,
            self._active_private_key,
            algorithm='RS256',
            headers={'kid': self._active_kid, 'typ': 'at+jwt'},
        )


def _rsa_modulus_bits(encoded_modulus: str) -> int:
    try:
        padding = '=' * (-len(encoded_modulus) % 4)
        modulus = base64.urlsafe_b64decode(encoded_modulus + padding)
    except (ValueError, TypeError) as error:
        raise ValueError('RSA signing JWK modulus is not valid base64url') from error
    return int.from_bytes(modulus, byteorder='big').bit_length()
