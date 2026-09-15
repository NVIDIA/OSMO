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

load("@aspect_rules_py//py:defs.bzl", "py_image_layer")
load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

osmo_py_library(
    name = "fastmcp_runtime",
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
        requirement("pydantic"),
        requirement("python-multipart"),
        requirement("redis"),
        requirement("starlette"),
        requirement("uncalled-for"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_contracts",
    srcs = [
        "app_action_models.py",
        "app_models.py",
        "credential_action_models.py",
        "pool_models.py",
        "resource_models.py",
        "tool_errors.py",
        "tool_models.py",
        "tool_validation.py",
        "workflow_action_models.py",
        "workflow_models.py",
    ],
    deps = [
        ":fastmcp_runtime",
        requirement("pydantic"),
        "//src/lib/utils:workflow_labels",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "transport",
    srcs = [
        "gateway.py",
        "request_context.py",
        "telemetry.py",
    ],
    deps = [
        ":fastmcp_runtime",
        requirement("httpx"),
        "//src/lib/utils:login",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_support",
    srcs = [
        "access_scope.py",
        "tool_requests.py",
    ],
    deps = [
        ":fastmcp_runtime",
        requirement("pydantic"),
        requirement("starlette"),
        ":tool_contracts",
        ":transport",
        "//src/lib/api:profile",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tools",
    srcs = [
        "app_actions.py",
        "app_submission.py",
        "apps.py",
        "credential_actions.py",
        "credentials.py",
        "health.py",
        "pools.py",
        "profile.py",
        "resources.py",
        "tool_registry.py",
        "workflow_actions.py",
        "workflow_submission.py",
        "workflows.py",
    ],
    deps = [
        ":fastmcp_runtime",
        requirement("mcp"),
        requirement("pydantic"),
        ":tool_contracts",
        ":tool_support",
        ":transport",
        "//src/lib/utils:resource_quantities",
        "//src/lib/utils:workflow_labels",
        "//src/lib/utils:workflow",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "mcp_service_lib",
    srcs = [
        "auth.py",
        "protocol.py",
        "request_body.py",
        "server.py",
    ],
    deps = [
        ":fastmcp_runtime",
        requirement("httpx"),
        requirement("pydantic"),
        requirement("starlette"),
        requirement("uvicorn"),
        ":tool_contracts",
        ":tools",
        ":transport",
        "//src/lib/utils:logging",
        "//src/utils:ssl_config",
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "mcp_binary",
    main = "server.py",
    srcs = ["server.py"],
    deps = [":mcp_service_lib"],
)

py_image_layer(
    name = "mcp_layer",
    binary = ":mcp_binary",
)

osmo_python_wrapper(
    name = "mcp_wrapper",
    bin_name = "mcp",
    main = "/src/service/mcp/server.py",
    runfiles_dir = "/src/service/mcp/mcp_binary.runfiles",
)

filegroup(
    name = "mcp_image_layers",
    srcs = [
        ":mcp_layer_default",
        ":mcp_layer_packages",
        ":mcp_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "mcp_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":mcp_image_layers"],
    visibility = ["//visibility:public"],
    target_compatible_with = ["@platforms//cpu:x86_64"],
)

oci_load(
    name = "mcp_image_load_x86_64",
    image = ":mcp_image_x86_64",
    repo_tags = ["osmo.local/mcp:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:x86_64"],
)

oci_push(
    name = "mcp_push_x86_64",
    image = ":mcp_image_x86_64",
    repository = BASE_IMAGE_URL + "mcp",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:x86_64"],
    visibility = ["//visibility:public"],
)

###############
#    arm64    #
###############

oci_image(
    name = "mcp_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":mcp_image_layers"],
    visibility = ["//visibility:public"],
    target_compatible_with = ["@platforms//cpu:arm64"],
)

oci_load(
    name = "mcp_image_load_arm64",
    image = ":mcp_image_arm64",
    repo_tags = ["osmo.local/mcp:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:arm64"],
)

oci_push(
    name = "mcp_push_arm64",
    image = ":mcp_image_arm64",
    repository = BASE_IMAGE_URL + "mcp",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:arm64"],
    visibility = ["//visibility:public"],
)
