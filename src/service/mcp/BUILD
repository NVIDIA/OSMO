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
    name = "mcp_service_lib",
    srcs = ["server.py"],
    deps = [
        requirement("mcp"),
        requirement("pydantic"),
        requirement("starlette"),
        requirement("uvicorn"),
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
