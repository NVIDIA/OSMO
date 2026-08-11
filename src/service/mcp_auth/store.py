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

import asyncio
import hashlib
import time
from typing import Protocol, TypeVar

import pydantic
import redis.asyncio as redis_asyncio  # type: ignore

from src.service.mcp_auth import models


_Record = TypeVar('_Record', bound=pydantic.BaseModel)


class BrokerStore(Protocol):
    """Shared state required by the authorization server."""

    async def put_client(
        self,
        registration: models.ClientRegistration,
        ttl_seconds: int,
    ) -> None:
        """Store a dynamic client registration."""

    async def get_client(self, client_id: str) -> models.ClientRegistration | None:
        """Load a client registration if it has not expired."""

    async def put_transaction(
        self,
        transaction_id: str,
        transaction: models.AuthorizationTransaction,
        ttl_seconds: int,
    ) -> None:
        """Store an upstream browser transaction."""

    async def consume_transaction(
        self,
        transaction_id: str,
    ) -> models.AuthorizationTransaction | None:
        """Atomically load and delete a browser transaction."""

    async def put_authorization_code(
        self,
        code_digest: str,
        authorization_code: models.AuthorizationCode,
        ttl_seconds: int,
    ) -> None:
        """Store a one-use authorization code by digest."""

    async def consume_authorization_code(
        self,
        code_digest: str,
    ) -> models.AuthorizationCode | None:
        """Atomically load and delete an authorization code."""

    async def put_refresh_session(
        self,
        token_digest: str,
        session: models.RefreshSession,
        ttl_seconds: int,
    ) -> None:
        """Store an opaque refresh token's session by digest."""

    async def rotate_refresh_session(
        self,
        old_token_digest: str,
        new_token_digest: str,
    ) -> models.RefreshSession | None:
        """Rotate once; reuse revokes the active token family."""

    async def revoke_refresh_session(self, token_digest: str) -> None:
        """Delete a refresh session when the token exists."""

    async def ping(self) -> bool:
        """Return whether the shared store is available."""

    async def close(self) -> None:
        """Release resources held by the store."""


def hash_token(token: str) -> str:
    """Return the stable, non-reversible Redis identifier for an opaque token."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


class RedisBrokerStore:
    """Redis implementation with atomic one-use and rotation operations."""

    _CONSUME_SCRIPT = """
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
"""
    _PUT_REFRESH_SCRIPT = """
if redis.call('EXISTS', KEYS[1]) == 1 or redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
"""
    _ROTATE_SCRIPT = """
local active_family = redis.call('GET', KEYS[1])
local spent_family = redis.call('GET', KEYS[2])
local family_json = redis.call('GET', KEYS[4])

if active_family then
  if active_family ~= ARGV[1] or not family_json then
    redis.call('DEL', KEYS[1])
    return nil
  end
  local family = cjson.decode(family_json)
  if family.active_token_digest ~= ARGV[2] then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[4])
    return nil
  end
  local ttl = redis.call('PTTL', KEYS[4])
  if ttl <= 0 then
    redis.call('DEL', KEYS[1])
    redis.call('DEL', KEYS[4])
    return nil
  end
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], ARGV[1], 'PX', ttl)
  redis.call('SET', KEYS[3], ARGV[1], 'PX', ttl)
  family.active_token_digest = ARGV[3]
  redis.call('SET', KEYS[4], cjson.encode(family), 'PX', ttl)
  return cjson.encode(family.session)
end

if spent_family then
  if family_json then
    local family = cjson.decode(family_json)
    if family.active_token_digest == ARGV[4] then
      redis.call('DEL', KEYS[5])
    end
    redis.call('DEL', KEYS[4])
  end
end
return nil
"""
    _REVOKE_SCRIPT = """
local active_family = redis.call('GET', KEYS[1])
local spent_family = redis.call('GET', KEYS[2])
local family_id = active_family or spent_family
if not family_id then
  return 0
end
local family_key = ARGV[1] .. ':family:' .. family_id
local family_json = redis.call('GET', family_key)
if family_json then
  local family = cjson.decode(family_json)
  local active_key = ARGV[1] .. ':refresh:' .. family.active_token_digest
  redis.call('DEL', active_key)
  redis.call('DEL', family_key)
end
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
return 1
"""

    def __init__(self, client: redis_asyncio.Redis, key_prefix: str) -> None:
        if not key_prefix or any(character in key_prefix for character in '{}'):
            raise ValueError('Redis key prefix must be non-empty and cannot contain braces')
        self._client = client
        # A shared hash tag keeps the two refresh keys in one Redis Cluster slot.
        self._key_prefix = f'{{{key_prefix}}}'

    @classmethod
    def from_url(
        cls,
        redis_url: str,
        *,
        password: str | None,
        key_prefix: str,
        connect_timeout_seconds: int,
        operation_timeout_seconds: int,
    ) -> 'RedisBrokerStore':
        client = redis_asyncio.from_url(
            redis_url,
            password=password,
            decode_responses=True,
            socket_connect_timeout=connect_timeout_seconds,
            socket_timeout=operation_timeout_seconds,
            retry_on_timeout=False,
        )
        return cls(client, key_prefix)

    def _key(self, record_type: str, identifier: str) -> str:
        return f'{self._key_prefix}:{record_type}:{identifier}'

    async def _put(
        self,
        key: str,
        record: pydantic.BaseModel,
        ttl_seconds: int,
    ) -> None:
        stored = await self._client.set(
            key,
            record.model_dump_json(),
            ex=ttl_seconds,
            nx=True,
        )
        if not stored:
            raise RuntimeError('Generated OAuth record identifier collided')

    async def _get(
        self,
        key: str,
        record_type: type[_Record],
    ) -> _Record | None:
        serialized = await self._client.get(key)  # type: ignore[misc]
        if serialized is None:
            return None
        return record_type.model_validate_json(serialized)

    async def _consume(
        self,
        key: str,
        record_type: type[_Record],
    ) -> _Record | None:
        serialized = await self._client.eval(  # type: ignore[misc]
            self._CONSUME_SCRIPT,
            1,
            key,
        )
        if serialized is None:
            return None
        return record_type.model_validate_json(serialized)

    async def put_client(
        self,
        registration: models.ClientRegistration,
        ttl_seconds: int,
    ) -> None:
        await self._put(
            self._key('client', registration.client_id),
            registration,
            ttl_seconds,
        )

    async def get_client(self, client_id: str) -> models.ClientRegistration | None:
        return await self._get(
            self._key('client', client_id),
            models.ClientRegistration,
        )

    async def put_transaction(
        self,
        transaction_id: str,
        transaction: models.AuthorizationTransaction,
        ttl_seconds: int,
    ) -> None:
        await self._put(
            self._key('transaction', transaction_id),
            transaction,
            ttl_seconds,
        )

    async def consume_transaction(
        self,
        transaction_id: str,
    ) -> models.AuthorizationTransaction | None:
        return await self._consume(
            self._key('transaction', transaction_id),
            models.AuthorizationTransaction,
        )

    async def put_authorization_code(
        self,
        code_digest: str,
        authorization_code: models.AuthorizationCode,
        ttl_seconds: int,
    ) -> None:
        await self._put(
            self._key('code', code_digest),
            authorization_code,
            ttl_seconds,
        )

    async def consume_authorization_code(
        self,
        code_digest: str,
    ) -> models.AuthorizationCode | None:
        return await self._consume(
            self._key('code', code_digest),
            models.AuthorizationCode,
        )

    async def put_refresh_session(
        self,
        token_digest: str,
        session: models.RefreshSession,
        ttl_seconds: int,
    ) -> None:
        family = models.RefreshFamily(
            active_token_digest=token_digest,
            session=session,
        )
        stored = await self._client.eval(  # type: ignore[misc]
            self._PUT_REFRESH_SCRIPT,
            2,
            self._key('refresh', token_digest),
            self._key('family', session.family_id),
            session.family_id,
            family.model_dump_json(),
            ttl_seconds,
        )
        if stored != 1:
            raise RuntimeError('Generated OAuth refresh identifier collided')

    async def rotate_refresh_session(
        self,
        old_token_digest: str,
        new_token_digest: str,
    ) -> models.RefreshSession | None:
        old_key = self._key('refresh', old_token_digest)
        spent_key = self._key('spent', old_token_digest)
        family_id = await self._client.get(old_key)  # type: ignore[misc]
        if family_id is None:
            family_id = await self._client.get(spent_key)  # type: ignore[misc]
        if family_id is None:
            return None

        family_key = self._key('family', family_id)
        serialized_family = await self._client.get(family_key)  # type: ignore[misc]
        snapshot_digest = old_token_digest
        if serialized_family is not None:
            family = models.RefreshFamily.model_validate_json(serialized_family)
            snapshot_digest = family.active_token_digest
        serialized = await self._client.eval(  # type: ignore[misc]
            self._ROTATE_SCRIPT,
            5,
            old_key,
            spent_key,
            self._key('refresh', new_token_digest),
            family_key,
            self._key('refresh', snapshot_digest),
            family_id,
            old_token_digest,
            new_token_digest,
            snapshot_digest,
        )
        if serialized is None:
            return None
        return models.RefreshSession.model_validate_json(serialized)

    async def revoke_refresh_session(self, token_digest: str) -> None:
        await self._client.eval(  # type: ignore[misc]
            self._REVOKE_SCRIPT,
            2,
            self._key('refresh', token_digest),
            self._key('spent', token_digest),
            self._key_prefix,
        )

    async def ping(self) -> bool:
        return bool(await self._client.ping())  # type: ignore[misc]

    async def close(self) -> None:
        await self._client.aclose()


class InMemoryBrokerStore:
    """Concurrency-safe store used by protocol tests and local composition."""

    def __init__(self) -> None:
        self._records: dict[str, tuple[float, str]] = {}
        self._refresh_tokens: dict[str, str] = {}
        self._spent_refresh_tokens: dict[str, tuple[float, str]] = {}
        self._refresh_families: dict[str, tuple[float, models.RefreshFamily]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(record_type: str, identifier: str) -> str:
        return f'{record_type}:{identifier}'

    async def _put(
        self,
        key: str,
        record: pydantic.BaseModel,
        ttl_seconds: int,
    ) -> None:
        async with self._lock:
            self._purge_expired()
            if key in self._records:
                raise RuntimeError('Generated OAuth record identifier collided')
            self._records[key] = (
                time.time() + ttl_seconds,
                record.model_dump_json(),
            )

    async def _get(
        self,
        key: str,
        record_type: type[_Record],
    ) -> _Record | None:
        async with self._lock:
            self._purge_expired()
            record = self._records.get(key)
            if record is None:
                return None
            return record_type.model_validate_json(record[1])

    async def _consume(
        self,
        key: str,
        record_type: type[_Record],
    ) -> _Record | None:
        async with self._lock:
            self._purge_expired()
            record = self._records.pop(key, None)
            if record is None:
                return None
            return record_type.model_validate_json(record[1])

    def _purge_expired(self) -> None:
        now = time.time()
        expired = [key for key, (expires_at, _) in self._records.items() if expires_at <= now]
        for key in expired:
            del self._records[key]
        expired_families = [
            family_id
            for family_id, (expires_at, _) in self._refresh_families.items()
            if expires_at <= now
        ]
        for family_id in expired_families:
            self._revoke_family(family_id)
        expired_spent_tokens = [
            digest
            for digest, (expires_at, _) in self._spent_refresh_tokens.items()
            if expires_at <= now
        ]
        for digest in expired_spent_tokens:
            del self._spent_refresh_tokens[digest]

    def _revoke_family(self, family_id: str) -> None:
        family_record = self._refresh_families.pop(family_id, None)
        if family_record is not None:
            self._refresh_tokens.pop(family_record[1].active_token_digest, None)

    async def put_client(
        self,
        registration: models.ClientRegistration,
        ttl_seconds: int,
    ) -> None:
        await self._put(self._key('client', registration.client_id), registration, ttl_seconds)

    async def get_client(self, client_id: str) -> models.ClientRegistration | None:
        return await self._get(self._key('client', client_id), models.ClientRegistration)

    async def put_transaction(
        self,
        transaction_id: str,
        transaction: models.AuthorizationTransaction,
        ttl_seconds: int,
    ) -> None:
        await self._put(self._key('transaction', transaction_id), transaction, ttl_seconds)

    async def consume_transaction(
        self,
        transaction_id: str,
    ) -> models.AuthorizationTransaction | None:
        return await self._consume(
            self._key('transaction', transaction_id),
            models.AuthorizationTransaction,
        )

    async def put_authorization_code(
        self,
        code_digest: str,
        authorization_code: models.AuthorizationCode,
        ttl_seconds: int,
    ) -> None:
        await self._put(self._key('code', code_digest), authorization_code, ttl_seconds)

    async def consume_authorization_code(
        self,
        code_digest: str,
    ) -> models.AuthorizationCode | None:
        return await self._consume(self._key('code', code_digest), models.AuthorizationCode)

    async def put_refresh_session(
        self,
        token_digest: str,
        session: models.RefreshSession,
        ttl_seconds: int,
    ) -> None:
        async with self._lock:
            self._purge_expired()
            if token_digest in self._refresh_tokens or session.family_id in self._refresh_families:
                raise RuntimeError('Generated OAuth refresh identifier collided')
            self._refresh_tokens[token_digest] = session.family_id
            self._refresh_families[session.family_id] = (
                time.time() + ttl_seconds,
                models.RefreshFamily(
                    active_token_digest=token_digest,
                    session=session,
                ),
            )

    async def rotate_refresh_session(
        self,
        old_token_digest: str,
        new_token_digest: str,
    ) -> models.RefreshSession | None:
        async with self._lock:
            self._purge_expired()
            if new_token_digest in self._refresh_tokens:
                return None
            family_id = self._refresh_tokens.pop(old_token_digest, None)
            if family_id is None:
                spent_record = self._spent_refresh_tokens.get(old_token_digest)
                if spent_record is not None:
                    self._revoke_family(spent_record[1])
                return None
            family_record = self._refresh_families.get(family_id)
            if family_record is None:
                return None
            expires_at, family = family_record
            if family.active_token_digest != old_token_digest:
                self._revoke_family(family_id)
                return None
            self._spent_refresh_tokens[old_token_digest] = (expires_at, family_id)
            self._refresh_tokens[new_token_digest] = family_id
            self._refresh_families[family_id] = (
                expires_at,
                family.model_copy(update={'active_token_digest': new_token_digest}),
            )
            return family.session

    async def revoke_refresh_session(self, token_digest: str) -> None:
        async with self._lock:
            family_id = self._refresh_tokens.get(token_digest)
            if family_id is None:
                spent_record = self._spent_refresh_tokens.get(token_digest)
                family_id = spent_record[1] if spent_record is not None else None
            if family_id is not None:
                self._revoke_family(family_id)

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None
