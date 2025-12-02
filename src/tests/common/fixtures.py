"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from src.tests.common.core.network import NetworkFixture
from src.tests.common.core.reaper import ReaperFixture
from src.tests.common.database.postgres import PostgresFixture, PostgresTestIsolationFixture
from src.tests.common.envoy.ssl_proxy import SslProxyFixture
from src.tests.common.registry.registry import DockerRegistryFixture
from src.tests.common.storage.swift import SwiftStorageFixture
from src.tests.common.storage.s3 import S3StorageFixture
from src.tests.common.storage.redis import RedisStorageFixture

__all__ = [
    "DockerRegistryFixture",
    "NetworkFixture",
    "PostgresFixture",
    "PostgresTestIsolationFixture",
    "RedisStorageFixture",
    "ReaperFixture",
    "SslProxyFixture",
    "SwiftStorageFixture",
    "S3StorageFixture",
]


class OsmoTestFixture(ReaperFixture, NetworkFixture):
    """
    A base test fixture for all tests. Sets up minimum Docker environment (i.e. network, reaper)
    for any testcontainers fixtures to be used.
    """
    pass
