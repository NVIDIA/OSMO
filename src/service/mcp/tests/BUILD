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

load("//bzl:py.bzl", "osmo_py_library", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_auth",
    srcs = ["test_auth.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("py-key-value-aio"),
        requirement("pydantic"),
        "//src/service/mcp:auth",
        "//src/service/mcp:mcp_service_lib",
    ],
)

osmo_py_library(
    name = "protocol_harness",
    srcs = ["protocol_harness.py"],
    deps = [
        requirement("httpx"),
        requirement("starlette"),
        "//src/lib/utils:login",
        "//src/service/mcp:gateway",
        "//src/service/mcp:mcp_service_lib",
        "//src/service/mcp:protocol",
        "//src/service/mcp:request_context",
        "//src/service/mcp:tool_registry",
    ],
)

osmo_py_test(
    name = "test_app_actions",
    srcs = ["test_app_actions.py"],
    deps = [
        requirement("httpx"),
        ":protocol_harness",
    ],
)

osmo_py_test(
    name = "test_app_submission",
    srcs = ["test_app_submission.py"],
    deps = [
        requirement("httpx"),
        ":protocol_harness",
    ],
)

osmo_py_test(
    name = "test_apps",
    srcs = ["test_apps.py"],
    deps = [
        requirement("httpx"),
        ":protocol_harness",
    ],
)

osmo_py_test(
    name = "test_catalog",
    srcs = ["test_catalog.py"],
    deps = [
        "//src/service/mcp:app_action_tools",
        "//src/service/mcp:app_submission_tools",
        "//src/service/mcp:app_tools",
        "//src/service/mcp:credential_action_tools",
        "//src/service/mcp:credential_tools",
        "//src/service/mcp:health_tools",
        "//src/service/mcp:pool_tools",
        "//src/service/mcp:profile_tools",
        "//src/service/mcp:protocol",
        "//src/service/mcp:resource_tools",
        "//src/service/mcp:tool_registry",
        "//src/service/mcp:workflow_action_tools",
        "//src/service/mcp:workflow_tools",
    ],
)

osmo_py_test(
    name = "test_cli_parity",
    srcs = ["test_cli_parity.py"],
    deps = [
        "//src/cli:cli_lib",
        "//src/lib/utils:resource_quantities",
        "//src/lib/utils:workflow_labels",
        "//src/lib/utils:workflow",
        "//src/service/mcp:app_action_models",
        "//src/service/mcp:app_submission_tools",
        "//src/service/mcp:resource_tools",
        "//src/service/mcp:tool_registry",
        "//src/service/mcp:workflow_action_models",
        "//src/service/mcp:workflow_action_tools",
        "//src/service/mcp:workflow_models",
        "//src/service/mcp:workflow_submission",
        "//src/service/mcp:workflow_tools",
    ],
)

osmo_py_test(
    name = "test_credentials",
    srcs = ["test_credentials.py"],
    deps = [
        requirement("httpx"),
        ":protocol_harness",
    ],
)

osmo_py_test(
    name = "test_credential_actions",
    srcs = ["test_credential_actions.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        ":protocol_harness",
        "//src/service/mcp:credential_action_models",
        "//src/service/mcp:credential_action_tools",
    ],
)

osmo_py_test(
    name = "test_gateway",
    srcs = ["test_gateway.py"],
    deps = [
        requirement("httpx"),
        "//src/service/mcp:gateway",
        "//src/service/mcp:request_context",
    ],
)

osmo_py_test(
    name = "test_pools",
    srcs = ["test_pools.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        ":protocol_harness",
        "//src/service/mcp:pool_tools",
        "//src/service/mcp:request_context",
        "//src/service/mcp:tool_requests",
    ],
)

osmo_py_test(
    name = "test_protocol",
    srcs = ["test_protocol.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        requirement("pydantic"),
        "//src/lib/utils:login",
        "//src/service/mcp:protocol",
        "//src/service/mcp:request_context",
        "//src/service/mcp:tool_errors",
    ],
)

osmo_py_test(
    name = "test_profile",
    srcs = ["test_profile.py"],
    deps = [
        requirement("httpx"),
        "//src/lib/utils:login",
        "//src/service/mcp:mcp_service_lib",
    ],
)

osmo_py_test(
    name = "test_resources",
    srcs = ["test_resources.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        ":protocol_harness",
        "//src/lib/utils:resource_quantities",
        "//src/service/mcp:request_context",
        "//src/service/mcp:resource_tools",
        "//src/service/mcp:tool_requests",
    ],
)

osmo_py_test(
    name = "test_request_context",
    srcs = ["test_request_context.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("starlette"),
        "//src/service/mcp:request_context",
    ],
)

osmo_py_test(
    name = "test_server",
    srcs = ["test_server.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        requirement("pydantic"),
        requirement("starlette"),
        "//src/lib/utils:login",
        "//src/service/mcp:gateway",
        "//src/service/mcp:request_body",
        "//src/service/mcp:request_context",
        "//src/service/mcp:mcp_service_lib",
        "//src/service/mcp:tool_registry",
    ],
)

osmo_py_test(
    name = "test_tool_support",
    srcs = ["test_tool_support.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("mcp"),
        "//src/lib/utils:osmo_errors",
        "//src/service/mcp:gateway",
        "//src/service/mcp:request_context",
        "//src/service/mcp:tool_errors",
        "//src/service/mcp:tool_requests",
        "//src/service/mcp:tool_validation",
    ],
)

osmo_py_test(
    name = "test_telemetry",
    srcs = ["test_telemetry.py"],
    deps = [
        "//src/service/mcp:request_context",
        "//src/service/mcp:telemetry",
    ],
)

osmo_py_test(
    name = "test_workflows",
    srcs = ["test_workflows.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        ":protocol_harness",
        "//src/service/mcp:request_context",
        "//src/service/mcp:workflow_tools",
    ],
)

osmo_py_test(
    name = "test_workflow_actions",
    srcs = ["test_workflow_actions.py"],
    deps = [
        "//src/service/mcp:fastmcp_runtime",
        requirement("httpx"),
        requirement("mcp"),
        ":protocol_harness",
        "//src/service/mcp:workflow_action_tools",
    ],
)
