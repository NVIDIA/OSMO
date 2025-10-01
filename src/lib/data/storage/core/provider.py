# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Top level module for providing data storage clients based on the storage backend.
"""

import abc
import dataclasses
import contextlib
import logging
import queue
from typing import Any, Generator, Protocol

from . import client
from ....utils import osmo_errors


logger = logging.getLogger(__name__)


########################
#   Provider Schemas   #
########################


class StorageClientProviderError(osmo_errors.OSMODataStorageError):
    """
    Exception raised when a storage client pool operation fails.
    """
    pass


class StorageClientProvider(Protocol):
    """
    Protocol for a storage client provider.
    """

    def __enter__(self) -> 'StorageClientProvider':
        ...

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        ...

    def bind(self, storage_profile: str) -> 'StorageClientProvider':
        """
        Returns a provider that is bound to a storage profile.
        """
        return self

    @contextlib.contextmanager
    def get(self) -> Generator[client.StorageClient, None, None]:
        """
        Context manager to get a storage client.
        """
        pass

    def close(self) -> None:
        ...


@dataclasses.dataclass(frozen=True)
class StorageClientFactory(abc.ABC):
    """
    A base class for creating storage clients.
    """

    @abc.abstractmethod
    def create(self) -> client.StorageClient:
        ...

    def to_provider(self, pool: bool = False) -> StorageClientProvider:
        """
        Returns a provider that uses this factory.
        """
        return StorageClientPool(self) if pool else CacheableClientProvider(self)


################################
#   Provider Implementations   #
################################


class CacheableClientProvider(StorageClientProvider):
    """
    A provider that caches a storage client. This is NOT thread-safe.
    """

    _client_factory: StorageClientFactory
    _cached_client: client.StorageClient | None = None

    def __init__(self, client_factory: StorageClientFactory):
        self._client_factory = client_factory

    def __enter__(self) -> 'CacheableClientProvider':
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()

    @contextlib.contextmanager
    def get(self) -> Generator[client.StorageClient, None, None]:
        """
        Returns the cached client. If the client has not been created yet, it will be created.
        """
        if self._cached_client is None:
            self._cached_client = self._client_factory.create()
        yield self._cached_client

    def close(self) -> None:
        if self._cached_client is not None:
            self._cached_client.close()
            self._cached_client = None


class StorageClientPool(StorageClientProvider):
    """
    A pool of storage clients that can be shared across threads in the same process.

    This is thread-safe.
    """

    _client_factory: StorageClientFactory
    _available_clients: queue.SimpleQueue[client.StorageClient]

    def __init__(
        self,
        client_factory: StorageClientFactory,
    ):
        self._client_factory = client_factory
        self._available_clients = queue.SimpleQueue[client.StorageClient]()

    def __enter__(self) -> 'StorageClientPool':
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()

    @contextlib.contextmanager
    def get(self) -> Generator[client.StorageClient, None, None]:
        """
        Get a storage client from the pool.
        """
        storage_client: client.StorageClient | None = None

        try:
            storage_client = self._available_clients.get_nowait()
        except queue.Empty:
            storage_client = self._client_factory.create()

        try:
            yield storage_client
        finally:
            self._available_clients.put(storage_client)

    def close(self) -> None:
        while not self._available_clients.empty():
            try:
                storage_client = self._available_clients.get_nowait()
            except queue.Empty:
                break
            try:
                storage_client.close()
            except Exception as err:  # pylint: disable=broad-except
                logger.exception('Failed to close storage client: %s', err)
