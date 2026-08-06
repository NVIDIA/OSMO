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
import time
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlparse

from src.lib.utils import login, osmo_errors


def _make_jwt(claims: dict) -> str:
    """Build an unsigned JWT whose payload base64url-decodes to ``claims``."""
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').decode().rstrip('=')
    payload = base64.urlsafe_b64encode(
        json.dumps(claims).encode()).decode().rstrip('=')
    return f'{header}.{payload}.sig'


class _FakeResponse:
    """Minimal stand-in for requests.Response."""

    def __init__(self, status_code: int = 200,
                 json_body: dict | None = None,
                 text: str = ''):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}
        self.text = text

    def json(self):
        return self._json_body


class FetchLoginInfoTests(unittest.TestCase):
    """Tests for fetch_login_info."""

    def test_success_returns_parsed_json(self):
        fake = _FakeResponse(status_code=200,
                             json_body={'token_endpoint': 'https://idp/token'})
        with mock.patch('src.lib.utils.login.requests.get',
                        return_value=fake) as mock_get:
            result = login.fetch_login_info('https://osmo.example.com')

        self.assertEqual(result, {'token_endpoint': 'https://idp/token'})
        mock_get.assert_called_once()
        called_url = mock_get.call_args.args[0]
        self.assertEqual(called_url, 'https://osmo.example.com/api/auth/login')

    def test_status_500_raises_user_error(self):
        fake = _FakeResponse(status_code=500, text='server oops')
        with mock.patch('src.lib.utils.login.requests.get', return_value=fake):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                login.fetch_login_info('https://osmo.example.com')

        self.assertIn('500', str(ctx.exception))
        self.assertIn('server oops', str(ctx.exception))

    def test_status_below_200_raises_user_error(self):
        fake = _FakeResponse(status_code=199, text='weird')
        with mock.patch('src.lib.utils.login.requests.get', return_value=fake):
            with self.assertRaises(osmo_errors.OSMOUserError):
                login.fetch_login_info('https://osmo.example.com')


class LoginConfigTokenOrDefaultTests(unittest.TestCase):
    """Tests for LoginConfig.token_or_default."""

    def test_returns_explicit_endpoint_when_set(self):
        config = login.LoginConfig(token_endpoint='https://explicit/token')

        with mock.patch('src.lib.utils.login.fetch_login_info') as mock_fetch:
            endpoint = config.token_or_default('https://osmo.example.com')

        self.assertEqual(endpoint, 'https://explicit/token')
        mock_fetch.assert_not_called()

    def test_fetches_endpoint_when_missing(self):
        config = login.LoginConfig()

        with mock.patch(
                'src.lib.utils.login.fetch_login_info',
                return_value={'token_endpoint': 'https://idp/discovered'}):
            endpoint = config.token_or_default('https://osmo.example.com')

        self.assertEqual(endpoint, 'https://idp/discovered')


class JwtTests(unittest.TestCase):
    """Tests for the Jwt helper."""

    def test_init_parses_claims(self):
        token = _make_jwt({'sub': 'user1', 'name': 'Alice'})

        jwt = login.Jwt(token)

        self.assertEqual(jwt.claims['sub'], 'user1')
        self.assertEqual(jwt.claims['name'], 'Alice')

    def test_str_returns_original_token(self):
        token = _make_jwt({'sub': 'user1'})

        jwt = login.Jwt(token)

        self.assertEqual(str(jwt), token)

    def test_expired_true_when_exp_in_past(self):
        token = _make_jwt({'exp': int(time.time()) - 100})

        jwt = login.Jwt(token)

        self.assertTrue(jwt.expired)

    def test_expired_false_when_exp_far_in_future(self):
        token = _make_jwt({'exp': int(time.time()) + 3600})

        jwt = login.Jwt(token)

        self.assertFalse(jwt.expired)

    def test_expired_true_when_within_expire_window(self):
        # exp within the EXPIRE_WINDOW (3s) is treated as expired.
        token = _make_jwt({'exp': int(time.time()) + 1})

        jwt = login.Jwt(token)

        self.assertTrue(jwt.expired)


class PkceUtilityTests(unittest.TestCase):
    """Tests for PKCE and authorization-request helpers."""

    def test_code_challenge_matches_rfc_7636_example(self):
        code_verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

        challenge = login.create_pkce_code_challenge(code_verifier)

        self.assertEqual(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')

    def test_generated_code_verifier_has_valid_length_and_characters(self):
        code_verifier = login.generate_pkce_code_verifier()

        self.assertGreaterEqual(len(code_verifier), 43)
        self.assertLessEqual(len(code_verifier), 128)
        self.assertTrue(set(code_verifier) <= set(
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'))

    def test_authorization_url_contains_security_parameters_and_scope(self):
        authorization_url = login.construct_pkce_authorization_url(
            browser_endpoint='https://idp.example.com/authorize?prompt=select_account',
            client_id='cli-client',
            redirect_uri='http://localhost:49152',
            state='expected-state',
            nonce='expected-nonce',
            code_challenge='challenge',
        )

        query = parse_qs(urlparse(authorization_url).query)
        self.assertEqual(query['client_id'], ['cli-client'])
        self.assertEqual(query['redirect_uri'], ['http://localhost:49152'])
        self.assertEqual(query['response_type'], ['code'])
        self.assertEqual(query['response_mode'], ['query'])
        self.assertEqual(query['scope'], ['openid offline_access profile'])
        self.assertEqual(query['state'], ['expected-state'])
        self.assertEqual(query['nonce'], ['expected-nonce'])
        self.assertEqual(query['code_challenge'], ['challenge'])
        self.assertEqual(query['code_challenge_method'], ['S256'])
        self.assertEqual(query['prompt'], ['select_account'])


class TokenLoginStorageTests(unittest.TestCase):
    """Tests for TokenLoginStorage.id_token_jwt lazy property."""

    def test_id_token_jwt_returns_jwt_with_claims(self):
        token = _make_jwt({'sub': 'user1', 'name': 'Alice'})
        storage = login.TokenLoginStorage(id_token=token)

        jwt = storage.id_token_jwt

        self.assertIsInstance(jwt, login.Jwt)
        self.assertEqual(jwt.claims['name'], 'Alice')

    def test_id_token_jwt_cached_across_calls(self):
        token = _make_jwt({'sub': 'user1'})
        storage = login.TokenLoginStorage(id_token=token)

        first = storage.id_token_jwt
        second = storage.id_token_jwt

        self.assertIs(first, second)


class LoginStorageValidatorTests(unittest.TestCase):
    """Tests for the LoginStorage model validators."""

    def test_validate_one_login_type_passes_non_dict_through(self):
        # Non-dict input must be returned unchanged (line 149).
        result = login.LoginStorage.validate_one_login_type('not-a-dict')  # type: ignore[operator]

        self.assertEqual(result, 'not-a-dict')

    def test_validate_one_login_type_rejects_zero_logins(self):
        with self.assertRaises(ValueError) as ctx:
            login.LoginStorage.validate_one_login_type({  # type: ignore[operator]
                'url': 'https://x',
                'token_login': None,
                'dev_login': None,
            })

        self.assertIn('exactly one', str(ctx.exception))

    def test_validate_one_login_type_rejects_both_logins(self):
        token = _make_jwt({'sub': 'u'})
        with self.assertRaises(ValueError):
            login.LoginStorage.validate_one_login_type({  # type: ignore[operator]
                'url': 'https://x',
                'token_login': {'id_token': token},
                'dev_login': {'username': 'alice'},
            })

    def test_validate_one_login_type_accepts_dev_only(self):
        result = login.LoginStorage.validate_one_login_type({  # type: ignore[operator]
            'url': 'https://x',
            'dev_login': {'username': 'alice'},
        })

        self.assertEqual(result['dev_login'], {'username': 'alice'})

    def test_url_validator_strips_trailing_slash(self):
        storage = login.LoginStorage(
            url='https://osmo.example.com/',
            dev_login=login.DevLoginStorage(username='alice'),
        )

        self.assertEqual(storage.url, 'https://osmo.example.com')


class LoginStorageNameTests(unittest.TestCase):
    """Tests for LoginStorage.name property."""

    def test_name_returns_token_jwt_name_claim(self):
        token = _make_jwt({'name': 'Alice'})
        storage = login.LoginStorage(
            url='https://osmo.example.com',
            token_login=login.TokenLoginStorage(id_token=token),
        )

        self.assertEqual(storage.name, 'Alice')

    def test_name_returns_dev_login_username(self):
        storage = login.LoginStorage(
            url='https://osmo.example.com',
            dev_login=login.DevLoginStorage(username='bob'),
        )

        self.assertEqual(storage.name, 'bob')

    def test_name_returns_empty_when_token_has_no_name_claim(self):
        token = _make_jwt({'sub': 'user1'})
        storage = login.LoginStorage(
            url='https://osmo.example.com',
            token_login=login.TokenLoginStorage(id_token=token),
        )

        self.assertEqual(storage.name, '')


class DevLoginTests(unittest.TestCase):
    """Tests for the dev_login helper."""

    def test_dev_login_builds_storage(self):
        storage = login.dev_login('https://osmo.example.com/', 'alice')

        self.assertEqual(storage.url, 'https://osmo.example.com')
        self.assertIsNotNone(storage.dev_login)
        self.assertEqual(storage.dev_login.username, 'alice')  # type: ignore[union-attr]
        self.assertIsNone(storage.token_login)


class OwnerPasswordLoginTests(unittest.TestCase):
    """Tests for owner_password_login (OAuth2 password grant)."""

    def _fake_login_info(self):
        return {
            'token_endpoint': 'https://idp/token',
            'device_client_id': 'osmo-client',
        }

    def test_success_posts_password_grant_and_returns_storage(self):
        token = _make_jwt({'sub': 'user1'})
        token_response = _FakeResponse(status_code=200, json_body={
            'id_token': token,
            'refresh_token': 'refresh-abc',
        })
        with mock.patch('src.lib.utils.login.fetch_login_info',
                        return_value=self._fake_login_info()), \
             mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response) as mock_post:
            storage = login.owner_password_login(
                config=login.LoginConfig(),
                url='https://osmo.example.com',
                username='alice',
                password='hunter2',
                user_agent=None,
            )

        self.assertIsNotNone(storage.token_login)
        token_login = storage.token_login
        self.assertEqual(token_login.id_token, token)  # type: ignore[union-attr]
        self.assertEqual(
            token_login.refresh_token, 'refresh-abc')  # type: ignore[union-attr]
        self.assertEqual(
            token_login.refresh_url, 'https://idp/token')  # type: ignore[union-attr]

        called_kwargs = mock_post.call_args.kwargs
        self.assertEqual(called_kwargs['data']['grant_type'], 'password')
        self.assertEqual(called_kwargs['data']['username'], 'alice')
        self.assertEqual(called_kwargs['data']['password'], 'hunter2')
        self.assertEqual(called_kwargs['data']['client_id'], 'osmo-client')
        self.assertEqual(called_kwargs['headers'], {})

    def test_success_sends_user_agent_header(self):
        token = _make_jwt({'sub': 'user1'})
        token_response = _FakeResponse(status_code=200, json_body={
            'id_token': token,
            'refresh_token': 'refresh-abc',
        })
        with mock.patch('src.lib.utils.login.fetch_login_info',
                        return_value=self._fake_login_info()), \
             mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response) as mock_post:
            login.owner_password_login(
                config=login.LoginConfig(),
                url='https://osmo.example.com',
                username='alice',
                password='hunter2',
                user_agent='osmo-cli/1.2.3',
            )

        self.assertEqual(mock_post.call_args.kwargs['headers']['User-Agent'],
                         'osmo-cli/1.2.3')

    def test_config_token_endpoint_overrides_discovered_endpoint(self):
        token = _make_jwt({'sub': 'user1'})
        token_response = _FakeResponse(status_code=200, json_body={
            'id_token': token,
            'refresh_token': 'r',
        })
        config = login.LoginConfig(token_endpoint='https://override/token',
                                   client_id='override-client')
        with mock.patch('src.lib.utils.login.fetch_login_info',
                        return_value=self._fake_login_info()), \
             mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response) as mock_post:
            storage = login.owner_password_login(
                config=config,
                url='https://osmo.example.com',
                username='alice',
                password='hunter2',
                user_agent=None,
            )

        self.assertEqual(mock_post.call_args.args[0], 'https://override/token')
        self.assertEqual(mock_post.call_args.kwargs['data']['client_id'],
                         'override-client')
        self.assertEqual(storage.token_login.refresh_url,  # type: ignore[union-attr]
                         'https://override/token')

    def test_non_200_status_raises_server_error(self):
        error_response = _FakeResponse(status_code=401,
                                       text='invalid credentials')
        with mock.patch('src.lib.utils.login.fetch_login_info',
                        return_value=self._fake_login_info()), \
             mock.patch('src.lib.utils.login.requests.post',
                        return_value=error_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                login.owner_password_login(
                    config=login.LoginConfig(),
                    url='https://osmo.example.com',
                    username='alice',
                    password='hunter2',
                    user_agent=None,
                )

        self.assertIn('invalid credentials', str(ctx.exception))


class AuthorizationCodeLoginTests(unittest.TestCase):
    """Tests for authorization-code exchange with PKCE."""

    def test_success_validates_nonce_and_stores_tokens(self):
        id_token = _make_jwt({'sub': 'user1', 'nonce': 'expected-nonce'})
        token_response = _FakeResponse(status_code=200, json_body={
            'id_token': id_token,
            'refresh_token': 'refresh-token',
        })
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response) as mock_post:
            storage = login.authorization_code_login(
                url='https://osmo.example.com',
                token_endpoint='https://idp.example.com/token',
                client_id='cli-client',
                authorization_code='authorization-code',
                code_verifier='code-verifier',
                redirect_uri='http://localhost:49152',
                expected_nonce='expected-nonce',
                user_agent='osmo-cli/1.2.3',
            )

        token_storage = storage.token_login
        self.assertIsNotNone(token_storage)
        assert token_storage is not None
        self.assertEqual(token_storage.id_token, id_token)
        self.assertEqual(token_storage.refresh_token, 'refresh-token')
        request_data = mock_post.call_args.kwargs['data']
        self.assertEqual(request_data['grant_type'], 'authorization_code')
        self.assertEqual(request_data['client_id'], 'cli-client')
        self.assertEqual(request_data['code'], 'authorization-code')
        self.assertEqual(request_data['code_verifier'], 'code-verifier')
        self.assertEqual(request_data['redirect_uri'], 'http://localhost:49152')
        self.assertEqual(request_data['scope'], 'openid offline_access profile')
        self.assertNotIn('client_secret', request_data)

    def test_rejects_id_token_with_wrong_nonce(self):
        id_token = _make_jwt({'sub': 'user1', 'nonce': 'wrong-nonce'})
        token_response = _FakeResponse(status_code=200, json_body={
            'id_token': id_token,
            'access_token': 'api-access-token',
        })
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as context:
                login.authorization_code_login(
                    url='https://osmo.example.com',
                    token_endpoint='https://idp.example.com/token',
                    client_id='cli-client',
                    authorization_code='authorization-code',
                    code_verifier='code-verifier',
                    redirect_uri='http://localhost:49152',
                    expected_nonce='expected-nonce',
                    user_agent=None,
                )

        self.assertIn('nonce', str(context.exception).lower())

    def test_rejects_insecure_token_endpoint_without_posting(self):
        with mock.patch('src.lib.utils.login.requests.post') as mock_post:
            with self.assertRaises(osmo_errors.OSMOUserError) as context:
                login.authorization_code_login(
                    url='https://osmo.example.com',
                    token_endpoint='http://idp.example.com/token',
                    client_id='cli-client',
                    authorization_code='authorization-code',
                    code_verifier='code-verifier',
                    redirect_uri='http://localhost:49152',
                    expected_nonce='expected-nonce',
                    user_agent=None,
                )

        self.assertIn('token endpoint must use HTTPS', str(context.exception))
        mock_post.assert_not_called()

    def test_non_200_token_response_raises(self):
        token_response = _FakeResponse(status_code=400, text='invalid_grant')
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as context:
                login.authorization_code_login(
                    url='https://osmo.example.com',
                    token_endpoint='https://idp.example.com/token',
                    client_id='cli-client',
                    authorization_code='authorization-code',
                    code_verifier='code-verifier',
                    redirect_uri='http://localhost:49152',
                    expected_nonce='expected-nonce',
                    user_agent=None,
                )

        self.assertIn('invalid_grant', str(context.exception))

    def test_rejects_token_endpoint_redirect(self):
        token_response = _FakeResponse(status_code=307,
                                       text='redirected to http://collector.invalid')
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response) as mock_post:
            with self.assertRaises(osmo_errors.OSMOServerError):
                login.authorization_code_login(
                    url='https://osmo.example.com',
                    token_endpoint='https://idp.example.com/token',
                    client_id='cli-client',
                    authorization_code='authorization-code',
                    code_verifier='code-verifier',
                    redirect_uri='http://localhost:49152',
                    expected_nonce='expected-nonce',
                    user_agent=None,
                )

        self.assertFalse(mock_post.call_args.kwargs['allow_redirects'])

    def test_missing_id_token_raises(self):
        token_response = _FakeResponse(status_code=200, json_body={
            'access_token': 'api-access-token',
        })
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=token_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as context:
                login.authorization_code_login(
                    url='https://osmo.example.com',
                    token_endpoint='https://idp.example.com/token',
                    client_id='cli-client',
                    authorization_code='authorization-code',
                    code_verifier='code-verifier',
                    redirect_uri='http://localhost:49152',
                    expected_nonce='expected-nonce',
                    user_agent=None,
                )

        self.assertIn('did not return an ID token', str(context.exception))


class ConstructTokenRefreshUrlTests(unittest.TestCase):
    """Tests for construct_token_refresh_url."""

    def test_appends_refresh_path(self):
        result = login.construct_token_refresh_url('https://osmo.example.com')

        self.assertEqual(result,
                         'https://osmo.example.com/api/auth/jwt/access_token')


class TokenLoginTests(unittest.TestCase):
    """Tests for the token_login helper (OSMO-token refresh flow)."""

    def test_success_returns_storage_with_osmo_token_true(self):
        new_id_token = _make_jwt({'sub': 'user1'})
        refresh_response = _FakeResponse(status_code=200, json_body={
            'token': new_id_token,
        })
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            storage = login.token_login(
                url='https://osmo.example.com',
                refresh_url='https://osmo.example.com/api/auth/jwt/access_token',
                refresh_token='osmo-refresh-abc',
                user_agent=None,
            )

        self.assertTrue(storage.osmo_token)
        self.assertEqual(storage.token_login.id_token, new_id_token)  # type: ignore[union-attr]
        self.assertEqual(storage.token_login.refresh_token,  # type: ignore[union-attr]
                         'osmo-refresh-abc')
        called_kwargs = mock_post.call_args.kwargs
        self.assertEqual(called_kwargs['json'], {'token': 'osmo-refresh-abc'})
        self.assertEqual(called_kwargs['headers'], {})

    def test_success_sends_user_agent_header(self):
        new_id_token = _make_jwt({'sub': 'user1'})
        refresh_response = _FakeResponse(status_code=200, json_body={
            'token': new_id_token,
        })
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            login.token_login(
                url='https://osmo.example.com',
                refresh_url='https://osmo.example.com/api/auth/jwt/access_token',
                refresh_token='osmo-refresh-abc',
                user_agent='osmo-cli/9.9',
            )

        self.assertEqual(mock_post.call_args.kwargs['headers']['User-Agent'],
                         'osmo-cli/9.9')

    def test_error_status_raises_server_error(self):
        error_response = _FakeResponse(status_code=401, text='expired')
        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=error_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                login.token_login(
                    url='https://osmo.example.com',
                    refresh_url='https://x/refresh',
                    refresh_token='osmo-refresh-abc',
                    user_agent=None,
                )

        self.assertIn('401', str(ctx.exception))
        self.assertIn('expired', str(ctx.exception))


class RefreshIdTokenTests(unittest.TestCase):
    """Tests for refresh_id_token."""

    def test_returns_none_when_storage_missing(self):
        result = login.refresh_id_token(
            config=login.LoginConfig(),
            user_agent=None,
            token_login_storage=None,
        )

        self.assertIsNone(result)

    def test_returns_none_when_token_not_expired(self):
        token = _make_jwt({'exp': int(time.time()) + 3600})
        storage = login.TokenLoginStorage(id_token=token,
                                          refresh_token='r',
                                          refresh_url='https://idp/token')

        result = login.refresh_id_token(
            config=login.LoginConfig(),
            user_agent=None,
            token_login_storage=storage,
        )

        self.assertIsNone(result)

    def test_missing_refresh_token_raises_when_not_osmo_token(self):
        token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(id_token=token,
                                          refresh_token=None,
                                          refresh_url='https://idp/token')

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            login.refresh_id_token(
                config=login.LoginConfig(),
                user_agent=None,
                token_login_storage=storage,
                osmo_token=False,
            )

        self.assertIn('no refresh token', str(ctx.exception).lower())

    def test_missing_refresh_url_raises(self):
        token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(id_token=token,
                                          refresh_token='r',
                                          refresh_url=None)

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            login.refresh_id_token(
                config=login.LoginConfig(),
                user_agent=None,
                token_login_storage=storage,
                osmo_token=False,
            )

        self.assertIn('refresh url', str(ctx.exception).lower())

    def test_oauth_flow_refreshes_and_updates_tokens(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        new_id_token = _make_jwt({'exp': int(time.time()) + 3600})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='old-refresh',
            refresh_url='https://idp/token',
            client_id='storage-client',
        )
        refresh_response = _FakeResponse(status_code=200, json_body={
            'id_token': new_id_token,
            'refresh_token': 'new-refresh',
        })

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            result = login.refresh_id_token(
                config=login.LoginConfig(client_id='config-client'),
                user_agent=None,
                token_login_storage=storage,
                osmo_token=False,
            )

        self.assertIs(result, storage)
        self.assertEqual(storage.id_token, new_id_token)
        self.assertEqual(storage.refresh_token, 'new-refresh')
        called_kwargs = mock_post.call_args.kwargs
        self.assertEqual(called_kwargs['data']['grant_type'], 'refresh_token')
        self.assertEqual(called_kwargs['data']['refresh_token'], 'old-refresh')
        # storage.client_id wins over config.client_id
        self.assertEqual(called_kwargs['data']['client_id'], 'storage-client')

    def test_oauth_flow_falls_back_to_config_client_id(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        new_id_token = _make_jwt({'exp': int(time.time()) + 3600})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='old-refresh',
            refresh_url='https://idp/token',
        )
        refresh_response = _FakeResponse(status_code=200, json_body={
            'id_token': new_id_token,
            'refresh_token': 'new-refresh',
        })

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            login.refresh_id_token(
                config=login.LoginConfig(client_id='config-client'),
                user_agent=None,
                token_login_storage=storage,
                osmo_token=False,
            )

        self.assertEqual(mock_post.call_args.kwargs['data']['client_id'],
                         'config-client')

    def test_oauth_flow_rejects_refresh_without_id_token(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='old-refresh',
            refresh_url='https://idp/token',
            client_id='storage-client',
        )
        refresh_response = _FakeResponse(status_code=200, json_body={
            'access_token': 'new-access-token',
            'refresh_token': 'new-refresh',
        })

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as context:
                login.refresh_id_token(
                    config=login.LoginConfig(),
                    user_agent=None,
                    token_login_storage=storage,
                    osmo_token=False,
                )

        self.assertIn('did not return an ID token', str(context.exception))
        self.assertIn('re-login', str(context.exception))
        self.assertEqual(storage.id_token, expired_token)
        self.assertEqual(storage.refresh_token, 'old-refresh')

    def test_oauth_flow_rejects_insecure_refresh_url_without_posting(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='old-refresh',
            refresh_url='http://idp.example.com/token',
            client_id='storage-client',
        )

        with mock.patch('src.lib.utils.login.requests.post') as mock_post:
            with self.assertRaises(osmo_errors.OSMOUserError) as context:
                login.refresh_id_token(
                    config=login.LoginConfig(),
                    user_agent=None,
                    token_login_storage=storage,
                    osmo_token=False,
                )

        self.assertIn('token endpoint must use HTTPS', str(context.exception))
        mock_post.assert_not_called()

    def test_oauth_flow_rejects_refresh_redirect(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='old-refresh',
            refresh_url='https://idp.example.com/token',
            client_id='storage-client',
        )
        refresh_response = _FakeResponse(
            status_code=308,
            text='redirected to http://collector.invalid',
        )

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            with self.assertRaises(osmo_errors.OSMOServerError):
                login.refresh_id_token(
                    config=login.LoginConfig(),
                    user_agent=None,
                    token_login_storage=storage,
                    osmo_token=False,
                )

        self.assertFalse(mock_post.call_args.kwargs['allow_redirects'])

    def test_osmo_token_flow_posts_token_json(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        new_id_token = _make_jwt({'exp': int(time.time()) + 3600})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='osmo-refresh',
            refresh_url='https://osmo.example.com/api/auth/jwt/access_token',
        )
        refresh_response = _FakeResponse(status_code=200, json_body={
            'token': new_id_token,
        })

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            result = login.refresh_id_token(
                config=login.LoginConfig(),
                user_agent=None,
                token_login_storage=storage,
                osmo_token=True,
            )

        self.assertIs(result, storage)
        self.assertEqual(storage.id_token, new_id_token)
        # refresh_token is NOT rotated for osmo-token flow
        self.assertEqual(storage.refresh_token, 'osmo-refresh')
        self.assertEqual(mock_post.call_args.kwargs['json'],
                         {'token': 'osmo-refresh'})

    def test_osmo_token_flow_sends_user_agent(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        new_id_token = _make_jwt({'exp': int(time.time()) + 3600})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='osmo-refresh',
            refresh_url='https://osmo.example.com/api/auth/jwt/access_token',
        )
        refresh_response = _FakeResponse(status_code=200, json_body={
            'token': new_id_token,
        })

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=refresh_response) as mock_post:
            login.refresh_id_token(
                config=login.LoginConfig(),
                user_agent='osmo-cli/2.0',
                token_login_storage=storage,
                osmo_token=True,
            )

        self.assertEqual(mock_post.call_args.kwargs['headers']['User-Agent'],
                         'osmo-cli/2.0')

    def test_error_status_raises_server_error(self):
        expired_token = _make_jwt({'exp': int(time.time()) - 60})
        storage = login.TokenLoginStorage(
            id_token=expired_token,
            refresh_token='osmo-refresh',
            refresh_url='https://osmo.example.com/api/auth/jwt/access_token',
        )
        error_response = _FakeResponse(status_code=401, text='invalid')

        with mock.patch('src.lib.utils.login.requests.post',
                        return_value=error_response):
            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                login.refresh_id_token(
                    config=login.LoginConfig(),
                    user_agent=None,
                    token_login_storage=storage,
                    osmo_token=True,
                )

        self.assertIn('401', str(ctx.exception))
        self.assertIn('invalid', str(ctx.exception))


class ConstructRolesListTests(unittest.TestCase):
    """Tests for construct_roles_list."""

    def test_none_returns_empty_list(self):
        self.assertEqual(login.construct_roles_list(None), [])

    def test_empty_string_returns_empty_list(self):
        self.assertEqual(login.construct_roles_list(''), [])

    def test_splits_comma_separated_roles(self):
        self.assertEqual(login.construct_roles_list('admin,user,viewer'),
                         ['admin', 'user', 'viewer'])


class ParseAllowedPoolsTests(unittest.TestCase):
    """Tests for parse_allowed_pools."""

    def test_none_returns_empty_list(self):
        self.assertEqual(login.parse_allowed_pools(None), [])

    def test_empty_string_returns_empty_list(self):
        self.assertEqual(login.parse_allowed_pools(''), [])

    def test_splits_and_strips_pools(self):
        self.assertEqual(
            login.parse_allowed_pools('pool-a, pool-b ,pool-c'),
            ['pool-a', 'pool-b', 'pool-c'])

    def test_drops_empty_segments(self):
        # Trailing comma or blank segments should be filtered out.
        self.assertEqual(
            login.parse_allowed_pools('pool-a,,pool-b, '),
            ['pool-a', 'pool-b'])


if __name__ == '__main__':
    unittest.main()
