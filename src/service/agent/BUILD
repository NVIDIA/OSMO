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

load("@aspect_rules_py//py:defs.bzl", "py_image_layer")
load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

osmo_py_library(
    name = "agent_service_lib",
    srcs = [
        "agent_service.py",
    ],
    deps = [
        ":helpers",
        requirement("fastapi"),
        requirement("uvicorn"),
        "//src/utils:backend_messages",
        "//src/utils/metrics",
        "//src/utils/progress_check:progress_check_lib",
        "//src/service/core/auth",
        "//src/service/core/config",
        "//src/service/core/workflow",
    ],
    visibility = ["//src/service:__subpackages__"],
)

osmo_py_binary(
    name = "agent_service_binary",
    main = "agent_service.py",
    srcs = ["agent_service.py"],
    deps = [":agent_service_lib"],
)

py_image_layer(
    name = "agent_service_layer",
    binary = ":agent_service_binary",
)

osmo_python_wrapper(
    name = "agent_service_wrapper",
    bin_name = "agent_service",
    main = "/src/service/agent/agent_service.py",
    runfiles_dir = "/src/service/agent/agent_service_binary.runfiles",
)

filegroup(
    name = "agent_service_image_layers",
    srcs = [
        ":agent_service_layer_default",
        ":agent_service_layer_packages",
        ":agent_service_wrapper",
    ],
)

osmo_py_library(
    name = "helpers",
    srcs = [
        "objects.py",
        "helpers.py",
    ],
    deps = [
        requirement("fastapi"),
        requirement("kombu"),
        requirement("pydantic"),
        requirement("redis"),
        requirement("websockets"),
        "//src/lib/utils:cache",
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/service/core/config",
        "//src/utils/metrics",
        "//src/utils/job",
        "//src/utils/job:backend_job",
        "//src/utils/progress_check:progress_check_lib",
    ],
    visibility = ["//src/service:__subpackages__"],
)

################
#    x86_64    #
################

oci_image(
    name = "agent_service_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":agent_service_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "agent_service_image_load_x86_64",
    image = ":agent_service_image_x86_64",
    repo_tags = ["osmo.local/agent:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "agent_service_push_x86_64",
    image = ":agent_service_image_x86_64",
    repository = BASE_IMAGE_URL + "agent",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "agent_service_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":agent_service_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "agent_service_image_load_arm64",
    image = ":agent_service_image_arm64",
    repo_tags = ["osmo.local/agent:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "agent_service_push_arm64",
    image = ":agent_service_image_arm64",
    repository = BASE_IMAGE_URL + "agent",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
