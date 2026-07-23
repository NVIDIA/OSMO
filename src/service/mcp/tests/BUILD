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

osmo_py_library(
    name = "protocol_harness",
    srcs = ["protocol_harness.py"],
    deps = [
        requirement("httpx"),
        requirement("starlette"),
        "//src/lib/utils:login",
        "//src/service/mcp:gateway",
        "//src/service/mcp:protocol",
        "//src/service/mcp:request_context",
        "//src/service/mcp:tool_registry",
    ],
)

osmo_py_test(
    name = "test_catalog",
    srcs = ["test_catalog.py"],
    deps = [
        "//src/service/mcp:health_tools",
        "//src/service/mcp:pool_tools",
        "//src/service/mcp:profile_tools",
        "//src/service/mcp:protocol",
        "//src/service/mcp:resource_tools",
        "//src/service/mcp:tool_registry",
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
        requirement("starlette"),
        "//src/service/mcp:request_context",
    ],
)

osmo_py_test(
    name = "test_server",
    srcs = ["test_server.py"],
    deps = [
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
