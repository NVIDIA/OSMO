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
Module for multiplexing storage clients during data operations.

This is for unique use cases where a single data operation needs to use multiple
storage clients. For example, 1 dataset download operation may use multiple storage backends.
"""

import contextlib
import dataclasses
import functools
import threading
from typing import Any, Dict, Generator, Generic, List, TypeVar
from typing_extensions import override

from . import backends
from .core import client, executor, header, progress, provider
from ...utils import cache, client_configs


_T = TypeVar('_T', bound=executor.ThreadWorkerInput)  # Input object type
_R = TypeVar('_R', bound=executor.ThreadWorkerOutput)  # Output object type


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class MuxThreadWorkerInput(executor.ThreadWorkerInput, Generic[_T]):
    """
    A thread worker input that uses multiplexed storage clients.
    """
    storage_profile: str
    worker_input: _T
    size: int = dataclasses.field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, 'size', self.worker_input.size)

    @override
    def error_key(self) -> str:
        return self.worker_input.error_key()


@dataclasses.dataclass(frozen=True)
class MuxStorageClientFactory(provider.StorageClientFactory):
    """
    A storage client factory meant for instantiating a multiplexed storage client provider.
    """

    request_headers: List[header.RequestHeaders] | None = dataclasses.field(default=None)
    kwargs: Dict[str, Any] = dataclasses.field(default_factory=dict)

    def create(self) -> client.StorageClient:
        """
        This method is not supported for this factory.
        """
        raise RuntimeError('MuxStorageClientFactory.create() is not supported.')

    def to_provider(self, pool: bool = False) -> provider.StorageClientProvider:
        """
        Returns a provider that uses this factory.
        """
        return MuxStorageClientProvider(
            client_factory=self,
            pool=pool,
            cache_config=client_configs.get_cache_config(),
        )


class MuxStorageClientProvider(provider.StorageClientProvider):
    """
    A storage client provider wrapper that multiplexes storage clients.
    """

    _client_factory: MuxStorageClientFactory
    _pool: bool
    _cache_config: cache.CacheConfig | None

    _client_providers: Dict[str, provider.StorageClientProvider]
    _lock: threading.Lock

    def __init__(
        self,
        client_factory: MuxStorageClientFactory,
        pool: bool = False,
        cache_config: cache.CacheConfig | None = None,
    ):
        self._client_factory = client_factory
        self._pool = pool
        self._cache_config = cache_config

        self._client_providers = {}
        self._lock = threading.Lock()

    def __enter__(self) -> 'MuxStorageClientProvider':
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        self.close()

    def close(self) -> None:
        for client_provider in self._client_providers.values():
            client_provider.close()

    def bind(self, storage_profile: str) -> provider.StorageClientProvider:
        """
        Returns a provider that is bound to a storage profile.
        """
        # Fast path: cache hit without locking
        client_provider = self._client_providers.get(storage_profile)
        if client_provider is not None:
            return client_provider

        # Pre-init factory outside of the lock
        # May be redundantly computed by multiple threads and that is okay.
        data_cred = client_configs.get_credentials(storage_profile)
        storage_backend = backends.construct_storage_backend(
            uri=storage_profile,
            profile=True,
            cache_config=self._cache_config,
        )
        client_factory = storage_backend.client_factory(
            access_key_id=data_cred.access_key_id,
            access_key=data_cred.get_access_key_value(),
            region=data_cred.region,
            request_headers=self._client_factory.request_headers,
            **self._client_factory.kwargs,
        )

        # Lock to ensure thread-safe caching of the provider.
        with self._lock:
            if storage_profile not in self._client_providers:
                self._client_providers[storage_profile] = client_factory.to_provider(self._pool)

        return self._client_providers[storage_profile]

    @contextlib.contextmanager
    def get(self) -> Generator[client.StorageClient, None, None]:
        """
        This method is not supported for this provider.
        """
        raise RuntimeError('MuxStorageClientProvider.get() is not supported.')


def _mux_thread_worker_wrapper(
    thread_worker: executor.ThreadWorker[_T, _R],
    mux_thread_worker_input: MuxThreadWorkerInput[_T],
    client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> _R:
    """
    Wraps a thread worker to use a multiplexed storage client provider.
    """
    return thread_worker(
        mux_thread_worker_input.worker_input,
        client_provider.bind(mux_thread_worker_input.storage_profile),
        progress_updater,
    )


def run_multiplexed_job(
    thread_worker: executor.ThreadWorker[_T, _R],
    thread_worker_input_gen: executor.WorkerInputGenerator[MuxThreadWorkerInput[_T]],
    client_factory: MuxStorageClientFactory,
    enable_progress_tracker: bool,
    executor_params: executor.ExecutorParameters,
) -> executor.JobContext[MuxThreadWorkerInput[_T], _R]:
    """
    Unified entry point for executing a job that uses multiplexed storage clients.
    """
    mux_thread_worker: executor.ThreadWorker[MuxThreadWorkerInput[_T], _R] = functools.partial(
        _mux_thread_worker_wrapper,
        thread_worker,
    )

    return executor.run_job(
        mux_thread_worker,
        thread_worker_input_gen,
        client_factory,
        enable_progress_tracker,
        executor_params,
    )
