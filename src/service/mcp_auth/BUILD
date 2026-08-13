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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "mcp_auth_lib",
    srcs = [
        "__init__.py",
        "config.py",
    ],
    deps = [
        requirement("pydantic"),
        "//src/lib/utils:logging",
        "//src/utils:ssl_config",
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "mcp_auth_service_lib",
    srcs = ["server.py"],
    deps = [
        requirement("authlib"),
        requirement("cryptography"),
        requirement("fastmcp-slim"),
        requirement("griffelib"),
        requirement("httpx"),
        requirement("joserfc"),
        requirement("jsonref"),
        requirement("mcp"),
        requirement("packaging"),
        requirement("py-key-value-aio"),
        requirement("python-multipart"),
        requirement("redis"),
        requirement("starlette"),
        requirement("uncalled-for"),
        requirement("uvicorn"),
        ":mcp_auth_lib",
        "//src/lib/utils:logging",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "mcp_auth_binary",
    srcs = ["server.py"],
    main = "server.py",
    deps = [":mcp_auth_service_lib"],
    visibility = ["//visibility:public"],
)
