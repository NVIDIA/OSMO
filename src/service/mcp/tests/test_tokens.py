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

import asyncio
import contextvars
import dataclasses
import inspect
import json
import pathlib
import shutil
import tempfile
import unittest
from collections.abc import AsyncIterator, Callable, Coroutine
from unittest import mock

import httpx

from src.service.mcp import identity, tokens


@dataclasses.dataclass
class _FakeClock:
    """Wall and monotonic clocks advanced together by tests."""

    wall: float = 1000
    monotonic: float = 5000

    def wall_time(self) -> float:
        return self.wall

    def monotonic_time(self) -> float:
        return self.monotonic

    def advance(self, seconds: float) -> None:
        self.wall += seconds
        self.monotonic += seconds


class _TrackingStream(httpx.AsyncByteStream):
    """Async response stream that records how many chunks were consumed."""

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.chunks_read = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            self.chunks_read += 1
            yield chunk

    async def aclose(self) -> None:
        return None


Handler = (
    Callable[[httpx.Request], httpx.Response] |
    Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]
)


class TokenProviderTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        temporary_directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temporary_directory)
        self.credential_path = temporary_directory / 'service-token'
        self.credential_path.write_text('initial-pat\n', encoding='utf-8')
        self.clock = _FakeClock()
        self.clients: list[httpx.AsyncClient] = []
        self.request_identity: contextvars.ContextVar[identity.RequestIdentity] = (
            contextvars.ContextVar(
                'test_mcp_request_identity',
                default=identity.RequestIdentity('alice', None),
            ))

    async def asyncTearDown(self) -> None:
        await asyncio.gather(*(client.aclose() for client in self.clients))

    async def test_service_token_exact_request_cache_and_request_id(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return self._token_response('service-jwt', lifetime=300)

        provider = self._service_provider(handler)
        first = await provider.get_token('request-123')
        second = await provider.get_token('request-456')

        self.assertEqual(first, 'service-jwt')
        self.assertEqual(second, 'service-jwt')
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].method, 'POST')
        self.assertEqual(requests[0].url.path, '/api/auth/jwt/access_token')
        self.assertEqual(json.loads(requests[0].content), {'token': 'initial-pat'})
        self.assertEqual(requests[0].headers['x-request-id'], 'request-123')
        self.assertNotIn('authorization', requests[0].headers)

    async def test_service_token_refresh_rereads_rotated_credential(self) -> None:
        request_bodies: list[dict[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            request_body = json.loads(request.content)
            request_bodies.append(request_body)
            return self._token_response(
                f'service-jwt-{len(request_bodies)}', lifetime=100)

        provider = self._service_provider(handler, cache_skew_seconds=30)
        self.assertEqual(await provider.get_token(), 'service-jwt-1')
        self.clock.advance(69)
        self.assertEqual(await provider.get_token(), 'service-jwt-1')

        self.credential_path.write_text('rotated-pat\n', encoding='utf-8')
        self.clock.advance(2)
        self.assertEqual(await provider.get_token(), 'service-jwt-2')
        self.assertEqual(
            request_bodies,
            [{'token': 'initial-pat'}, {'token': 'rotated-pat'}],
        )

    async def test_service_token_refresh_is_single_flight(self) -> None:
        request_started = asyncio.Event()
        release_request = asyncio.Event()
        request_count = 0

        async def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            request_started.set()
            await release_request.wait()
            return self._token_response('service-jwt', lifetime=300)

        provider = self._service_provider(handler)
        waiters = [asyncio.create_task(provider.get_token()) for _ in range(10)]
        await asyncio.wait_for(request_started.wait(), timeout=5)
        release_request.set()

        self.assertEqual(await asyncio.gather(*waiters), ['service-jwt'] * 10)
        self.assertEqual(request_count, 1)

    async def test_cancelled_waiter_does_not_cancel_service_token_refresh(self) -> None:
        request_started = asyncio.Event()
        release_request = asyncio.Event()
        request_count = 0

        async def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            request_started.set()
            await release_request.wait()
            return self._token_response('service-jwt', lifetime=300)

        provider = self._service_provider(handler)
        cancelled_waiter = asyncio.create_task(provider.get_token())
        await asyncio.wait_for(request_started.wait(), timeout=5)
        cancelled_waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await cancelled_waiter

        surviving_waiter = asyncio.create_task(provider.get_token())
        release_request.set()
        self.assertEqual(await surviving_waiter, 'service-jwt')
        self.assertEqual(await provider.get_token(), 'service-jwt')
        self.assertEqual(request_count, 1)

    async def test_stale_service_token_invalidation_preserves_replacement(self) -> None:
        request_count = 0

        def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            return self._token_response(
                f'service-jwt-{request_count}', lifetime=300)

        provider = self._service_provider(handler)
        first_token = await provider.get_token()
        self.assertTrue(await provider.invalidate(first_token))
        replacement_token = await provider.get_token()

        self.assertFalse(await provider.invalidate(first_token))
        self.assertEqual(await provider.get_token(), replacement_token)
        self.assertEqual(replacement_token, 'service-jwt-2')
        self.assertEqual(request_count, 2)

    async def test_service_token_failure_does_not_expose_secrets(self) -> None:
        response_secret = 'upstream-secret'

        def handler(unused_request: httpx.Request) -> httpx.Response:
            del unused_request
            return httpx.Response(500, text=f'{response_secret}: initial-pat')

        provider = self._service_provider(handler)
        with self.assertRaises(tokens.GatewayResponseError) as raised:
            await provider.get_token()

        message = str(raised.exception)
        self.assertNotIn('initial-pat', message)
        self.assertNotIn(response_secret, message)

    async def test_service_token_failure_is_not_cached(self) -> None:
        request_count = 0

        def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            if request_count == 1:
                return httpx.Response(503, text='try again')
            return self._token_response('service-jwt', lifetime=300)

        provider = self._service_provider(handler)
        with self.assertRaises(tokens.GatewayResponseError):
            await provider.get_token()
        self.assertEqual(await provider.get_token(), 'service-jwt')
        self.assertEqual(request_count, 2)

    async def test_service_token_rejects_unbounded_or_malformed_secret(self) -> None:
        request_count = 0

        def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            return self._token_response('unused', lifetime=300)

        invalid_credentials = (
            b'',
            b'\n',
            b'two tokens',
            b'two\ntokens',
            b'token\x00suffix',
            b'\xff',
            b'x' * (16 * 1024 + 1),
        )
        for credential in invalid_credentials:
            with self.subTest(credential_size=len(credential)):
                self.credential_path.write_bytes(credential)
                provider = self._service_provider(handler)
                with self.assertRaises(tokens.CredentialError):
                    await provider.get_token()

        self.credential_path.unlink()
        provider = self._service_provider(handler)
        with self.assertRaises(tokens.CredentialError):
            await provider.get_token()
        self.assertEqual(request_count, 0)

    async def test_service_credential_accepts_exact_size_limit(self) -> None:
        credential = 'x' * (16 * 1024)
        request_bodies: list[dict[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            request_bodies.append(json.loads(request.content))
            return self._token_response('service-jwt', lifetime=300)

        self.credential_path.write_text(credential, encoding='utf-8')
        provider = self._service_provider(handler)

        self.assertEqual(await provider.get_token(), 'service-jwt')
        self.assertEqual(request_bodies, [{'token': credential}])

    async def test_delegated_tokens_are_isolated_and_cached_per_exact_user(self) -> None:
        delegated_requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            delegated_requests.append(request)
            subject_user = json.loads(request.content)['subject_user']
            return self._token_response(f'delegated-{subject_user}', lifetime=300)

        provider = self._delegated_provider(handler)
        self.assertEqual(tuple(inspect.signature(provider.get_token).parameters), ())
        self.assertEqual(
            tuple(inspect.signature(provider.invalidate).parameters), ('token',))
        self.assertEqual(
            await self._get_delegated_token(
                provider, 'Alice', 'request-alice'), 'delegated-Alice')
        self.assertEqual(
            await self._get_delegated_token(
                provider, 'alice', 'request-lower'), 'delegated-alice')
        self.assertEqual(
            await self._get_delegated_token(
                provider, 'Alice', 'request-cached'), 'delegated-Alice')

        self.assertEqual(len(delegated_requests), 2)
        self.assertEqual(
            json.loads(delegated_requests[0].content), {'subject_user': 'Alice'})
        self.assertEqual(
            delegated_requests[0].headers['authorization'], 'Bearer service-jwt')
        self.assertEqual(
            delegated_requests[0].headers['x-request-id'], 'request-alice')

    async def test_delegated_token_cache_uses_lru_eviction(self) -> None:
        delegated_subjects: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            subject_user = json.loads(request.content)['subject_user']
            delegated_subjects.append(subject_user)
            return self._token_response(
                f'{subject_user}-{delegated_subjects.count(subject_user)}', lifetime=300)

        provider = self._delegated_provider(handler, cache_max_size=2)
        self.assertEqual(await self._get_delegated_token(provider, 'alice'), 'alice-1')
        self.assertEqual(await self._get_delegated_token(provider, 'bob'), 'bob-1')
        self.assertEqual(await self._get_delegated_token(provider, 'alice'), 'alice-1')
        self.assertEqual(await self._get_delegated_token(provider, 'carol'), 'carol-1')
        self.assertEqual(await self._get_delegated_token(provider, 'bob'), 'bob-2')
        self.assertEqual(delegated_subjects, ['alice', 'bob', 'carol', 'bob'])

    async def test_delegated_invalidation_compares_user_and_token(self) -> None:
        request_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            request_count += 1
            return self._token_response(f'delegated-{request_count}', lifetime=300)

        provider = self._delegated_provider(handler)
        first_token = await self._get_delegated_token(provider, 'alice')

        self.assertFalse(
            await self._invalidate_delegated_token(provider, 'bob', first_token))
        self.assertFalse(await self._invalidate_delegated_token(
            provider, 'alice', 'different-token'))
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), first_token)
        self.assertTrue(
            await self._invalidate_delegated_token(provider, 'alice', first_token))
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-2')

    async def test_delegated_token_cache_refreshes_at_skew(self) -> None:
        request_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            request_count += 1
            return self._token_response(f'delegated-{request_count}', lifetime=100)

        provider = self._delegated_provider(handler, cache_skew_seconds=30)
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-1')
        self.clock.advance(69)
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-1')
        self.clock.advance(2)
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-2')

    async def test_token_with_lifetime_equal_to_skew_is_not_cached(self) -> None:
        delegated_request_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal delegated_request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            delegated_request_count += 1
            return self._token_response(
                f'delegated-{delegated_request_count}', lifetime=30)

        provider = self._delegated_provider(handler, cache_skew_seconds=30)

        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-1')
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-2')
        self.assertEqual(delegated_request_count, 2)

    async def test_invalid_delegated_subject_fails_before_gateway_requests(self) -> None:
        request_count = 0

        def handler(unused_request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            del unused_request
            request_count += 1
            return self._token_response('unused', lifetime=300)

        provider = self._delegated_provider(handler)
        with self.assertRaises(ValueError):
            await self._get_delegated_token(provider, 'invalid\nsubject')
        self.assertEqual(request_count, 0)

    async def test_same_user_delegation_is_single_flight(self) -> None:
        delegation_started = asyncio.Event()
        release_delegation = asyncio.Event()
        request_count = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            request_count += 1
            delegation_started.set()
            await release_delegation.wait()
            return self._token_response('delegated-alice', lifetime=300)

        provider = self._delegated_provider(handler)
        waiters = [
            self._create_delegated_token_task(provider, 'alice') for _ in range(10)]
        await asyncio.wait_for(delegation_started.wait(), timeout=5)
        release_delegation.set()

        self.assertEqual(
            await asyncio.gather(*waiters), ['delegated-alice'] * 10)
        self.assertEqual(request_count, 1)

    async def test_different_user_delegations_run_in_parallel(self) -> None:
        subjects_started: list[str] = []
        both_started = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            subject_user = json.loads(request.content)['subject_user']
            subjects_started.append(subject_user)
            if len(subjects_started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), timeout=5)
            return self._token_response(f'delegated-{subject_user}', lifetime=300)

        provider = self._delegated_provider(handler)
        alice, bob = await asyncio.gather(
            self._get_delegated_token(provider, 'alice'),
            self._get_delegated_token(provider, 'bob'),
        )

        self.assertEqual(alice, 'delegated-alice')
        self.assertEqual(bob, 'delegated-bob')
        self.assertCountEqual(subjects_started, ['alice', 'bob'])

    async def test_failed_delegation_is_removed_from_single_flight(self) -> None:
        request_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            request_count += 1
            if request_count == 1:
                return httpx.Response(500, text='delegation failed')
            return self._token_response('delegated-alice', lifetime=300)

        provider = self._delegated_provider(handler)
        with self.assertRaises(tokens.GatewayResponseError):
            await self._get_delegated_token(provider, 'alice')
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-alice')
        self.assertEqual(request_count, 2)

    async def test_cancelled_waiter_does_not_cancel_shared_delegation(self) -> None:
        delegation_started = asyncio.Event()
        release_delegation = asyncio.Event()
        request_count = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            request_count += 1
            delegation_started.set()
            await release_delegation.wait()
            return self._token_response('delegated-alice', lifetime=300)

        provider = self._delegated_provider(handler)
        cancelled_waiter = self._create_delegated_token_task(provider, 'alice')
        await asyncio.wait_for(delegation_started.wait(), timeout=5)
        cancelled_waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await cancelled_waiter

        surviving_waiter = self._create_delegated_token_task(provider, 'alice')
        release_delegation.set()
        self.assertEqual(await surviving_waiter, 'delegated-alice')
        self.assertEqual(request_count, 1)

    async def test_delegation_401_invalidates_service_token_and_retries_once(self) -> None:
        service_request_count = 0
        authorization_headers: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal service_request_count
            if request.url.path == '/api/auth/jwt/access_token':
                service_request_count += 1
                return self._token_response(
                    f'service-jwt-{service_request_count}', lifetime=600)
            authorization = request.headers['authorization']
            authorization_headers.append(authorization)
            if authorization == 'Bearer service-jwt-1':
                return httpx.Response(401, text='expired service token')
            return self._token_response('delegated-alice', lifetime=300)

        provider = self._delegated_provider(handler)
        self.assertEqual(
            await self._get_delegated_token(provider, 'alice'), 'delegated-alice')
        self.assertEqual(service_request_count, 2)
        self.assertEqual(
            authorization_headers,
            ['Bearer service-jwt-1', 'Bearer service-jwt-2'],
        )

    async def test_concurrent_delegation_401s_share_one_service_refresh(self) -> None:
        service_request_count = 0
        old_token_attempt_count = 0
        all_old_token_attempts_started = asyncio.Event()
        delegation_attempts: dict[str, list[str]] = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal old_token_attempt_count, service_request_count
            if request.url.path == '/api/auth/jwt/access_token':
                service_request_count += 1
                return self._token_response(
                    f'service-jwt-{service_request_count}', lifetime=600)

            subject_user = json.loads(request.content)['subject_user']
            authorization = request.headers['authorization']
            delegation_attempts.setdefault(subject_user, []).append(authorization)
            if authorization == 'Bearer service-jwt-1':
                old_token_attempt_count += 1
                if old_token_attempt_count == 3:
                    all_old_token_attempts_started.set()
                await asyncio.wait_for(
                    all_old_token_attempts_started.wait(), timeout=5)
                return httpx.Response(401)
            return self._token_response(
                f'delegated-{subject_user}', lifetime=300)

        provider = self._delegated_provider(handler)
        alice, bob, carol = await asyncio.gather(
            self._get_delegated_token(provider, 'alice'),
            self._get_delegated_token(provider, 'bob'),
            self._get_delegated_token(provider, 'carol'),
        )

        self.assertEqual(
            (alice, bob, carol),
            ('delegated-alice', 'delegated-bob', 'delegated-carol'),
        )
        self.assertEqual(service_request_count, 2)
        self.assertEqual(
            delegation_attempts,
            {
                'alice': ['Bearer service-jwt-1', 'Bearer service-jwt-2'],
                'bob': ['Bearer service-jwt-1', 'Bearer service-jwt-2'],
                'carol': ['Bearer service-jwt-1', 'Bearer service-jwt-2'],
            },
        )

    async def test_second_delegation_401_is_not_retried(self) -> None:
        delegated_request_count = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal delegated_request_count
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt', lifetime=600)
            delegated_request_count += 1
            return httpx.Response(401, text='still unauthorized')

        provider = self._delegated_provider(handler)
        with self.assertRaises(tokens.GatewayResponseError) as raised:
            await self._get_delegated_token(provider, 'alice')
        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(delegated_request_count, 2)

    async def test_other_delegation_failures_are_not_retried(self) -> None:
        for status_code in (403, 404, 429, 500):
            with self.subTest(status_code=status_code):
                delegated_request_count = 0

                def handler(
                    request: httpx.Request,
                    response_status: int = status_code,
                ) -> httpx.Response:
                    nonlocal delegated_request_count
                    if request.url.path == '/api/auth/jwt/access_token':
                        return self._token_response('service-jwt', lifetime=600)
                    delegated_request_count += 1
                    return httpx.Response(response_status, text='sensitive body')

                provider = self._delegated_provider(handler)
                with self.assertRaises(tokens.GatewayResponseError) as raised:
                    await self._get_delegated_token(provider, 'alice')
                self.assertEqual(raised.exception.status_code, status_code)
                self.assertEqual(delegated_request_count, 1)

    async def test_gateway_transport_errors_are_sanitized(self) -> None:
        secret = 'sensitive.internal.example'
        error_factories = (
            lambda request: httpx.ConnectError(secret, request=request),
            lambda request: httpx.ConnectTimeout(secret, request=request),
            lambda request: httpx.ReadError(secret, request=request),
        )

        for error_factory in error_factories:
            with self.subTest(error_type=error_factory):
                def handler(
                    request: httpx.Request,
                    factory: Callable[[httpx.Request], httpx.RequestError] = error_factory,
                ) -> httpx.Response:
                    raise factory(request)

                provider = self._service_provider(handler)
                with self.assertRaises(tokens.GatewayUnavailableError) as raised:
                    await provider.get_token()
                self.assertNotIn(secret, str(raised.exception))

    async def test_gateway_redirect_is_not_followed(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                302,
                headers={'location': 'https://attacker.test/collect'},
            )

        provider = self._service_provider(handler)
        with self.assertRaises(tokens.GatewayResponseError) as raised:
            await provider.get_token()

        self.assertEqual(raised.exception.status_code, 302)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, '/api/auth/jwt/access_token')

    async def test_invalid_gateway_response_is_strict_and_redacted(self) -> None:
        leaked_token = 'leaked-jwt'

        def handler(unused_request: httpx.Request) -> httpx.Response:
            del unused_request
            return httpx.Response(200, json={
                'token': leaked_token,
                'expires_at': int(self.clock.wall + 300),
                'unexpected': 'field',
            })

        provider = self._service_provider(handler)
        with self.assertRaises(tokens.InvalidGatewayResponseError) as raised:
            await provider.get_token()
        self.assertNotIn(leaked_token, str(raised.exception))

    async def test_gateway_response_rejects_expired_wrong_type_and_huge_expiry(self) -> None:
        invalid_responses: tuple[object, ...] = (
            {'token': 'jwt', 'expires_at': int(self.clock.wall)},
            {'token': 'jwt', 'expires_at': '1300'},
            {'token': 123, 'expires_at': 1300},
            {'token': 'jwt'},
            {'expires_at': 1300},
            {'token': 'jwt', 'expires_at': 10**400},
            ['jwt', 1300],
        )

        for response_body in invalid_responses:
            with self.subTest(response_body=response_body):
                provider = self._service_provider(
                    lambda unused_request, body=response_body: httpx.Response(
                        200, json=body))
                with self.assertRaises(tokens.InvalidGatewayResponseError):
                    await provider.get_token()

    async def test_gateway_token_rejects_ascii_control_characters(self) -> None:
        for token_value in ('prefix\x00suffix', 'prefix\x1fsuffix', 'prefix\x7fsuffix'):
            with self.subTest(token_value=repr(token_value)):
                provider = self._service_provider(
                    lambda unused_request, value=token_value: self._token_response(
                        value, lifetime=300))
                with self.assertRaises(tokens.InvalidGatewayResponseError):
                    await provider.get_token()

    async def test_gateway_token_response_has_a_size_limit(self) -> None:
        response_secret = 'response-secret'

        def handler(unused_request: httpx.Request) -> httpx.Response:
            del unused_request
            return httpx.Response(
                200,
                content=(
                    b'{"token":"' +
                    response_secret.encode() +
                    b'x' * (128 * 1024) +
                    b'","expires_at":1300}'
                ),
            )

        provider = self._service_provider(handler)
        with self.assertRaises(tokens.InvalidGatewayResponseError) as raised:
            await provider.get_token()

        self.assertIn('size limit', str(raised.exception))
        self.assertNotIn(response_secret, str(raised.exception))

    async def test_gateway_response_size_limit_is_cumulative(self) -> None:
        stream = _TrackingStream([
            b'x' * (64 * 1024),
            b'y' * (65 * 1024),
            b'secret-third-chunk',
        ])
        provider = self._service_provider(
            lambda unused_request: httpx.Response(200, stream=stream))

        with self.assertRaises(tokens.InvalidGatewayResponseError):
            await provider.get_token()

        self.assertEqual(stream.chunks_read, 2)

    async def test_gateway_error_response_body_is_not_read(self) -> None:
        stream = _TrackingStream([b'sensitive-error-body'])
        provider = self._service_provider(
            lambda unused_request: httpx.Response(503, stream=stream))

        with self.assertRaises(tokens.GatewayResponseError) as raised:
            await provider.get_token()

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(stream.chunks_read, 0)

    async def test_gateway_token_length_boundary(self) -> None:
        accepted_token = 'x' * 65536
        accepted_provider = self._service_provider(
            lambda unused_request: self._token_response(
                accepted_token, lifetime=300))
        self.assertEqual(await accepted_provider.get_token(), accepted_token)

        rejected_provider = self._service_provider(
            lambda unused_request: self._token_response(
                'x' * 65537, lifetime=300))
        with self.assertRaises(tokens.InvalidGatewayResponseError):
            await rejected_provider.get_token()

    async def test_gateway_token_must_be_ascii(self) -> None:
        provider = self._service_provider(
            lambda unused_request: self._token_response('tökén', lifetime=300))

        with self.assertRaises(tokens.InvalidGatewayResponseError):
            await provider.get_token()

    async def test_app_context_configures_hardened_http_client(self) -> None:
        transport = mock.Mock(spec=httpx.AsyncBaseTransport)
        client = mock.MagicMock(spec=httpx.AsyncClient)
        client_context = mock.MagicMock()
        client_context.__aenter__ = mock.AsyncMock(return_value=client)
        client_context.__aexit__ = mock.AsyncMock(return_value=None)

        with mock.patch(
            'src.service.mcp.tokens.httpx.AsyncClient',
            return_value=client_context,
        ) as async_client:
            async with tokens.create_app_context(
                api_url='https://gateway.test',
                service_token_file=self.credential_path,
                request_timeout_seconds=12.5,
                token_cache_max_size=512,
                token_cache_skew_seconds=30,
                transport=transport,
            ) as app_context:
                self.assertIs(app_context.http_client, client)

        async_client.assert_called_once()
        client_context.__aenter__.assert_awaited_once_with()
        client_context.__aexit__.assert_awaited_once()
        kwargs = async_client.call_args.kwargs
        self.assertEqual(kwargs['base_url'], 'https://gateway.test')
        timeout = kwargs['timeout']
        self.assertEqual(
            (timeout.connect, timeout.read, timeout.write, timeout.pool),
            (12.5, 12.5, 12.5, 12.5),
        )
        self.assertFalse(kwargs['follow_redirects'])
        self.assertFalse(kwargs['trust_env'])
        self.assertIs(kwargs['verify'], True)
        self.assertIs(kwargs['transport'], transport)

    def _service_provider(
        self,
        handler: Handler,
        *,
        cache_skew_seconds: float = 30,
    ) -> tokens.ServiceTokenProvider:
        client = self._client(handler)
        return tokens.ServiceTokenProvider(
            client,
            self.credential_path,
            cache_skew_seconds,
            wall_time=self.clock.wall_time,
            monotonic_time=self.clock.monotonic_time,
        )

    def _delegated_provider(
        self,
        handler: Handler,
        *,
        cache_max_size: int = 512,
        cache_skew_seconds: float = 30,
    ) -> tokens.DelegatedTokenProvider:
        client = self._client(handler)
        service_provider = tokens.ServiceTokenProvider(
            client,
            self.credential_path,
            cache_skew_seconds,
            wall_time=self.clock.wall_time,
            monotonic_time=self.clock.monotonic_time,
        )
        return tokens.DelegatedTokenProvider(
            client,
            service_provider,
            cache_max_size,
            cache_skew_seconds,
            identity_resolver=self.request_identity.get,
            wall_time=self.clock.wall_time,
            monotonic_time=self.clock.monotonic_time,
        )

    async def _get_delegated_token(
        self,
        provider: tokens.DelegatedTokenProvider,
        user_name: str,
        request_id: str | None = None,
    ) -> str:
        context_token = self.request_identity.set(
            identity.RequestIdentity(user_name, request_id))
        try:
            return await provider.get_token()
        finally:
            self.request_identity.reset(context_token)

    async def _invalidate_delegated_token(
        self,
        provider: tokens.DelegatedTokenProvider,
        user_name: str,
        delegated_token: str,
    ) -> bool:
        context_token = self.request_identity.set(
            identity.RequestIdentity(user_name, None))
        try:
            return await provider.invalidate(delegated_token)
        finally:
            self.request_identity.reset(context_token)

    def _create_delegated_token_task(
        self,
        provider: tokens.DelegatedTokenProvider,
        user_name: str,
    ) -> asyncio.Task[str]:
        context_token = self.request_identity.set(
            identity.RequestIdentity(user_name, None))
        try:
            return asyncio.create_task(provider.get_token())
        finally:
            self.request_identity.reset(context_token)

    def _client(self, handler: Handler) -> httpx.AsyncClient:
        client = httpx.AsyncClient(
            base_url='https://gateway.test',
            transport=httpx.MockTransport(handler),
            follow_redirects=False,
            trust_env=False,
        )
        self.clients.append(client)
        return client

    def _token_response(self, token: str, *, lifetime: int) -> httpx.Response:
        return httpx.Response(200, json={
            'token': token,
            'expires_at': int(self.clock.wall + lifetime),
        })


if __name__ == '__main__':
    unittest.main()
