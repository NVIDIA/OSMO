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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_redis",
    srcs = ["test_redis.py"],
    deps = [
        "//src/utils/connectors:connectors",
        requirement("anyio"),
    ],
    size = "small",
)

py_test(
    name = "test_resource_spec",
    srcs = [
        "test_resource_spec.py"
        ],
    deps = [
        "//src/utils/connectors:connectors",
    ],
    tags = [
        "exclusive"
    ],
    size = "small"
)

py_test(
    name = "test_cli_config",
    srcs = [
        "test_cli_config.py"
        ],
    deps = [
        "//src/utils/connectors:connectors",
    ],
    tags = [
        "exclusive"
    ],
    size = "small"
)

py_test(
    name = "test_backend_resource",
    srcs = [
        "test_backend_resource.py"
        ],
    deps = [
        "//src/utils/connectors:connectors",
    ],
    tags = [
        "exclusive"
    ],
    size = "small"
)

osmo_py_test(
    name = "test_pool_config_authority",
    srcs = ["test_pool_config_authority.py"],
    deps = [
        "//src/utils:configmap_state",
        "//src/utils/connectors:connectors",
    ],
    size = "small",
)

osmo_py_test(
    name = "test_role_assignment_authority",
    srcs = ["test_role_assignment_authority.py"],
    deps = [
        "//src/utils:configmap_state",
        "//src/utils/connectors:connectors",
    ],
    size = "small",
)

py_test(
    name = "test_workflow_config",
    srcs = [
        "test_workflow_config.py"
    ],
    deps = [
        requirement("pydantic"),
        "//src/utils/connectors:connectors",
    ],
    tags = [
        "exclusive"
    ],
    size = "small"
)

py_test(
    name = "test_workflow_label_schema",
    srcs = ["test_workflow_label_schema.py"],
    deps = [
        "//src/utils/connectors:connectors",
    ],
    size = "small",
)

osmo_py_test(
    name = "test_user_names_db",
    srcs = ["test_user_names_db.py"],
    deps = [
        "//src/lib/utils:osmo_errors",
        "//src/tests/common",
        "//src/utils/connectors:connectors",
    ],
    size = "medium",
    tags = ["requires-network"],
)

py_test(
    name = "test_mek_reconciliation",
    srcs = ["test_mek_reconciliation.py"],
    deps = [
        "//src/lib/utils:osmo_errors",
        "//src/utils/connectors:connectors",
    ],
    size = "small",
)

py_test(
    name = "test_mek_reconciliation_postgres",
    srcs = ["test_mek_reconciliation_postgres.py"],
    deps = [
        requirement("jwcrypto"),
        requirement("psycopg2-binary"),
        "//src/lib/utils:osmo_errors",
        "//src/utils:auth",
        "//src/utils/connectors:connectors",
        "//src/utils/secret_manager",
        "//src/utils/secret_manager:mek_lifecycle",
    ],
    local = True,
    size = "medium",
    tags = ["exclusive", "integration"],
)

py_test(
    name = "test_service_auth",
    srcs = ["test_service_auth.py"],
    deps = [
        requirement("jwcrypto"),
        "//src/lib/utils:osmo_errors",
        "//src/utils:auth",
        "//src/utils:configmap_state",
        "//src/utils/connectors:connectors",
    ],
    size = "small",
)
