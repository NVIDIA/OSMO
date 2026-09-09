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

import tempfile
from typing import IO

from src.tests.common.core.network import NetworkFixture
from src.tests.common.core.reaper import ReaperFixture
from src.tests.common.database.postgres import PostgresFixture, PostgresTestIsolationFixture
from src.tests.common.envoy.ssl_proxy import SslProxyFixture
from src.tests.common.registry.registry import DockerRegistryFixture
from src.tests.common.storage.swift import SwiftStorageFixture
from src.tests.common.storage.s3 import S3StorageFixture
from src.tests.common.storage.redis import RedisStorageFixture
from src.utils import auth

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
    "create_configmap_file",
    "create_service_auth_file",
]


def create_service_auth_file() -> IO[str]:
    """Create an explicit file-backed identity for an isolated test process."""
    service_auth_file = tempfile.NamedTemporaryFile(  # pylint: disable=consider-using-with
        mode="w+", encoding="utf-8")
    service_auth_file.write(
        auth.AuthenticationConfig.generate_default().canonical_json(
            include_login_info=False))
    service_auth_file.flush()
    return service_auth_file


def create_configmap_file() -> IO[str]:
    """Create the minimum complete 6.4 runtime configuration document."""
    config_file = tempfile.NamedTemporaryFile(  # pylint: disable=consider-using-with
        mode="w+", encoding="utf-8")
    config_file.write(
        "service: {}\n"
        "workflow: {}\n"
        "pools: {}\n"
        "pod_templates: {}\n"
        "resource_validations: {}\n"
        "backends: {}\n"
        "backend_tests: {}\n"
        "group_templates: {}\n"
        "roles:\n"
        "  osmo-default:\n"
        "    description: Default test role\n"
        "    policies: []\n")
    config_file.flush()
    return config_file


class OsmoTestFixture(ReaperFixture, NetworkFixture):
    """
    A base test fixture for all tests. Sets up minimum Docker environment (i.e. network, reaper)
    for any testcontainers fixtures to be used.
    """
    pass
