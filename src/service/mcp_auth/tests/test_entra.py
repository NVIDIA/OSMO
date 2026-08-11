"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

import json
import time
import unittest
from urllib import parse

import httpx
from jwcrypto import jwk  # type: ignore
import jwt  # type: ignore

from src.service.mcp_auth import entra


class EntraOIDCProviderTest(unittest.IsolatedAsyncioTestCase):
    async def test_authorize_and_exchange_validate_oidc_and_filter_roles(self) -> None:
        issuer = 'https://login.example/tenant/v2.0'
        client_id = 'entra-client'
        nonce = 'expected-nonce'
        signing_key = jwk.JWK.generate(kty='RSA', kid='entra-key', size=2048)
        private_pem = signing_key.export_to_pem(private_key=True, password=None)
        public_jwk = json.loads(signing_key.export_public())
        id_token_claims = {
            'iss': issuer,
            'aud': client_id,
            'azp': client_id,
            'sub': 'pairwise-subject',
            'tid': 'tenant-id',
            'oid': 'object-id',
            'preferred_username': 'user@example.com',
            'roles': ['osmo-user', 'untrusted-role'],
            'nonce': nonce,
            'iat': int(time.time()),
            'exp': int(time.time()) + 300,
        }
        encoded_id_token = jwt.encode(
            id_token_claims,
            private_pem,
            algorithm='RS256',
            headers={'kid': 'entra-key'},
        )
        wrong_azp_token = jwt.encode(
            {
                **id_token_claims,
                'aud': [client_id, 'another-audience'],
                'azp': 'another-client',
            },
            private_pem,
            algorithm='RS256',
            headers={'kid': 'entra-key'},
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith('/.well-known/openid-configuration'):
                return httpx.Response(200, json={
                    'issuer': issuer,
                    'authorization_endpoint': 'https://login.example/authorize',
                    'token_endpoint': 'https://login.example/token',
                    'jwks_uri': 'https://login.example/jwks',
                })
            if request.url.path == '/jwks':
                return httpx.Response(200, json={'keys': [public_jwk]})
            if request.url.path == '/token':
                body = parse.parse_qs(request.content.decode())
                self.assertEqual(body['client_secret'], ['secret'])
                self.assertEqual(body['code_verifier'], ['upstream-verifier'])
                token = (
                    wrong_azp_token
                    if body['code'] == ['wrong-azp']
                    else encoded_id_token
                )
                return httpx.Response(200, json={'id_token': token})
            return httpx.Response(404)

        provider = entra.EntraOIDCProvider(
            issuer=issuer,
            client_id=client_id,
            client_secret='secret',
            redirect_uri='https://osmo.example/oauth/callback/entra',
            allowed_roles=frozenset({'osmo-user'}),
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        authorization_url = await provider.authorization_url(
            entra.UpstreamAuthorization(
                state='broker-state',
                nonce=nonce,
                code_challenge='challenge',
            )
        )
        authorization_query = parse.parse_qs(parse.urlsplit(authorization_url).query)
        self.assertEqual(authorization_query['scope'], ['openid profile email'])
        self.assertNotIn('offline_access', authorization_query['scope'][0])
        identity = await provider.exchange_authorization_code(
            code='upstream-code',
            nonce=nonce,
            code_verifier='upstream-verifier',
        )
        self.assertEqual(identity.subject, 'tenant-id:object-id')
        self.assertEqual(identity.username, 'user@example.com')
        self.assertEqual(identity.roles, ('osmo-user',))
        with self.assertRaisesRegex(ValueError, 'authorized party'):
            await provider.exchange_authorization_code(
                code='wrong-azp',
                nonce=nonce,
                code_verifier='upstream-verifier',
            )
        await provider.close()

    async def test_discovery_rejects_issuer_mismatch(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, json={
                'issuer': 'https://attacker.example',
                'authorization_endpoint': 'https://attacker.example/authorize',
                'token_endpoint': 'https://attacker.example/token',
                'jwks_uri': 'https://attacker.example/jwks',
            })

        provider = entra.EntraOIDCProvider(
            issuer='https://login.example/tenant/v2.0',
            client_id='client',
            client_secret='secret',
            redirect_uri='https://osmo.example/oauth/callback/entra',
            allowed_roles=frozenset(),
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        )
        self.assertFalse(await provider.ready())
        await provider.close()
