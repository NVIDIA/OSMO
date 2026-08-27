"""
SPDX-FileCopyrightText: NVIDIA CORPORATION
Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
import os
import tempfile
import unittest

from jwcrypto import jwk, jws, jwt

from src.lib.utils import osmo_errors
from src.utils import auth

# Verify that the keys we use have a RSA modulus of at least 4096 bits
MINIMUM_KEY_BIT_LENGTH = 4096

class TestAuth(unittest.TestCase):
    '''Test the default key pair generation and signing'''
    def test_default_key(self):
        default_key_pair = auth.AuthenticationConfig.generate_default()
        public_key = json.loads(default_key_pair.get_current_key().public_key)
        private_key = json.loads(default_key_pair.get_current_key().private_key.get_secret_value())
        # Test the private and public keys match
        self.assertEqual(public_key['n'], private_key['n'])
        self.assertEqual(public_key['e'], private_key['e'])
        self.assertEqual(public_key['kty'], private_key['kty'])

        # Test key bit length is sufficient
        key_bytes = base64.urlsafe_b64decode(public_key['n'] + '==')
        bit_length = int.from_bytes(key_bytes, 'big').bit_length()
        self.assertGreaterEqual(bit_length, MINIMUM_KEY_BIT_LENGTH,
            f'Key bit length is {bit_length}, expected at least {MINIMUM_KEY_BIT_LENGTH}')

        # Verify we use RSA
        self.assertEqual(public_key['kty'], 'RSA')

    def test_default_key_signing(self):
        # Get two key pairs
        default_key_pair_1 = auth.AuthenticationConfig.generate_default()
        default_key_pair_2 = auth.AuthenticationConfig.generate_default()

        # Sign two JWTs, they should have different signatures
        jwt1_str = default_key_pair_1.get_current_key().create_jwt({'sub': 'test'})
        jwt2_str = default_key_pair_2.get_current_key().create_jwt({'sub': 'test'})
        self.assertNotEqual(jwt1_str, jwt2_str)

        # Create JWT objects so we can validate them
        jwt1 = jwt.JWT.from_jose_token(jwt1_str)
        jwt2 = jwt.JWT.from_jose_token(jwt2_str)

        # Validate the JWTs
        jwt1.validate(jwk.JWK.from_json(default_key_pair_1.get_current_key().public_key))
        jwt2.validate(jwk.JWK.from_json(default_key_pair_2.get_current_key().public_key))

        # Validate the JWTs with the wrong keys
        with self.assertRaises(jws.InvalidJWSSignature):
            jwt1.validate(jwk.JWK.from_json(default_key_pair_2.get_current_key().public_key))
        with self.assertRaises(jws.InvalidJWSSignature):
            jwt2.validate(jwk.JWK.from_json(default_key_pair_1.get_current_key().public_key))

    def test_canonical_secret_file_round_trip(self):
        service_auth = auth.AuthenticationConfig.generate_default()
        with tempfile.TemporaryDirectory() as temporary_directory:
            auth_path = os.path.join(
                temporary_directory, 'authentication-config.json')
            with open(auth_path, 'w', encoding='utf-8') as auth_file:
                auth_file.write(service_auth.canonical_json(include_login_info=False))

            loaded = auth.load_authentication_config_file(auth_path)

        self.assertEqual(
            loaded.canonical_json(include_login_info=False),
            service_auth.canonical_json(include_login_info=False),
        )
        token = loaded.create_idtoken_jwt(
            expire_timestamp=2**31, username='test', roles=['osmo-user'])
        parsed_token = jwt.JWT.from_jose_token(token)
        parsed_token.validate(jwk.JWK.from_json(loaded.get_current_key().public_key))

    def test_invalid_secret_file_error_is_sanitized(self):
        sentinel = 'private-key-sentinel'
        with tempfile.TemporaryDirectory() as temporary_directory:
            auth_path = os.path.join(
                temporary_directory, 'authentication-config.json')
            with open(auth_path, 'w', encoding='utf-8') as auth_file:
                json.dump({
                    'keys': {
                        'bad': {
                            'public_key': '{}',
                            'private_key': sentinel,
                        },
                    },
                    'active_key': 'bad',
                    'issuer': 'osmo',
                    'audience': 'osmo',
                }, auth_file)

            with self.assertRaises(osmo_errors.OSMOError) as context:
                auth.load_authentication_config_file(auth_path)

        self.assertNotIn(sentinel, str(context.exception))


if __name__ == '__main__':
    unittest.main()
