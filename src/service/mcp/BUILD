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
    name = "request_context",
    srcs = ["request_context.py"],
    deps = [
        requirement("starlette"),
        "//src/lib/utils:login",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "request_body",
    srcs = ["request_body.py"],
    deps = [
        requirement("starlette"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "gateway",
    srcs = ["gateway.py"],
    deps = [
        requirement("httpx"),
        ":request_context",
        ":telemetry",
        "//src/lib/utils:login",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "telemetry",
    srcs = ["telemetry.py"],
    deps = [
        ":request_context",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_errors",
    srcs = ["tool_errors.py"],
    deps = [
        requirement("mcp"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_models",
    srcs = ["tool_models.py"],
    deps = [
        requirement("pydantic"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_validation",
    srcs = ["tool_validation.py"],
    deps = [
        requirement("pydantic"),
        ":tool_errors",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_requests",
    srcs = ["tool_requests.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        requirement("starlette"),
        ":gateway",
        ":request_context",
        ":tool_errors",
        "//src/lib/api:profile",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "access_scope",
    srcs = ["access_scope.py"],
    deps = [
        requirement("mcp"),
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "app_models",
    srcs = ["app_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "app_action_models",
    srcs = ["app_action_models.py"],
    deps = [
        requirement("pydantic"),
        ":app_models",
        ":tool_models",
        ":workflow_action_models",
        ":workflow_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "pool_models",
    srcs = ["pool_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "resource_models",
    srcs = ["resource_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "workflow_models",
    srcs = ["workflow_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "workflow_action_models",
    srcs = ["workflow_action_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
        ":workflow_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "credential_action_models",
    srcs = ["credential_action_models.py"],
    deps = [
        requirement("pydantic"),
        ":tool_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "profile_tools",
    srcs = ["profile.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":access_scope",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "health_tools",
    srcs = ["health.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":access_scope",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "pool_tools",
    srcs = ["pools.py"],
    deps = [
        requirement("mcp"),
        ":access_scope",
        ":pool_models",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "resource_tools",
    srcs = ["resources.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":access_scope",
        ":resource_models",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
        "//src/lib/utils:resource_quantities",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "workflow_tools",
    srcs = ["workflows.py"],
    deps = [
        requirement("mcp"),
        ":access_scope",
        ":gateway",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
        ":workflow_models",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "workflow_submission",
    srcs = ["workflow_submission.py"],
    deps = [
        requirement("mcp"),
        ":access_scope",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
        ":workflow_action_models",
        ":workflow_models",
        "//src/lib/utils:workflow",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "workflow_action_tools",
    srcs = ["workflow_actions.py"],
    deps = [
        requirement("mcp"),
        ":gateway",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
        ":workflow_action_models",
        ":workflow_models",
        ":workflow_submission",
        ":workflow_tools",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "app_tools",
    srcs = ["apps.py"],
    deps = [
        requirement("mcp"),
        ":app_models",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "app_action_tools",
    srcs = ["app_actions.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":app_action_models",
        ":app_models",
        ":app_tools",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "app_submission_tools",
    srcs = ["app_submission.py"],
    deps = [
        requirement("mcp"),
        ":app_action_models",
        ":app_models",
        ":app_tools",
        ":tool_requests",
        ":tool_validation",
        ":workflow_action_models",
        ":workflow_models",
        ":workflow_submission",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "credential_tools",
    srcs = ["credentials.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":tool_errors",
        ":tool_requests",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "credential_action_tools",
    srcs = ["credential_actions.py"],
    deps = [
        requirement("mcp"),
        ":credential_action_models",
        ":tool_errors",
        ":tool_requests",
        ":tool_validation",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "tool_registry",
    srcs = ["tool_registry.py"],
    deps = [
        requirement("mcp"),
        ":app_action_tools",
        ":app_submission_tools",
        ":app_tools",
        ":credential_action_tools",
        ":credential_tools",
        ":health_tools",
        ":pool_tools",
        ":profile_tools",
        ":resource_tools",
        ":workflow_action_tools",
        ":workflow_tools",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "protocol",
    srcs = ["protocol.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        ":request_context",
        ":telemetry",
        ":tool_errors",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "mcp_service_lib",
    srcs = ["server.py"],
    deps = [
        requirement("httpx"),
        requirement("mcp"),
        requirement("pydantic"),
        requirement("starlette"),
        requirement("uvicorn"),
        ":gateway",
        ":protocol",
        ":request_body",
        ":request_context",
        ":tool_registry",
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
        ":mcp_layer_interpreter",
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
    repo_tags = ["osmo.local/mcp-self-hosted:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:x86_64"],
)

oci_push(
    name = "mcp_push_x86_64",
    image = ":mcp_image_x86_64",
    repository = BASE_IMAGE_URL + "mcp-self-hosted",
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
    repo_tags = ["osmo.local/mcp-self-hosted:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:arm64"],
)

oci_push(
    name = "mcp_push_arm64",
    image = ":mcp_image_arm64",
    repository = BASE_IMAGE_URL + "mcp-self-hosted",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    tags = ["manual"],
    target_compatible_with = ["@platforms//cpu:arm64"],
    visibility = ["//visibility:public"],
)
