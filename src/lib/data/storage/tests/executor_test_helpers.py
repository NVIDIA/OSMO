# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
Test helpers for the multi-process executor.

Defined in a standalone module (not __main__) so they can be pickled and
unpickled across ``spawn`` multiprocessing boundaries in Bazel's sandbox.
"""

import dataclasses
from typing import cast

from src.lib.data.storage.core import client, executor, progress, provider


@dataclasses.dataclass(frozen=True, kw_only=True, slots=True)
class TestWorkerInput(executor.ThreadWorkerInput):
    size: int
    value: int

    def error_key(self) -> str:
        return str(self.value)


@dataclasses.dataclass(slots=True)
class TestWorkerOutput(executor.ThreadWorkerOutput['TestWorkerOutput']):
    total: int = 0

    def __add__(self, other: 'TestWorkerOutput | None') -> 'TestWorkerOutput':
        return TestWorkerOutput(total=self.total + (0 if other is None else other.total))

    def __iadd__(self, other: 'TestWorkerOutput | None') -> 'TestWorkerOutput':
        self.total += 0 if other is None else other.total
        return self


class TestStorageClient:
    def close(self) -> None:
        pass


@dataclasses.dataclass(frozen=True)
class TestStorageClientFactory(provider.StorageClientFactory):
    def create(self) -> client.StorageClient:
        return cast(client.StorageClient, TestStorageClient())


def test_thread_worker(
    worker_input: TestWorkerInput,
    storage_client_provider: provider.StorageClientProvider,
    progress_updater: progress.ProgressUpdater,
) -> TestWorkerOutput:
    del storage_client_provider
    progress_updater.update(amount_change=1)
    return TestWorkerOutput(total=worker_input.value)


def test_worker_inputs():
    for value in [1, 2, 3]:
        yield TestWorkerInput(size=1, value=value)
