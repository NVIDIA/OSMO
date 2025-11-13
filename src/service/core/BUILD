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
    name = "service_lib",
    srcs = [
        "service.py",
    ],
    deps = [
        requirement("diskcache"),
        requirement("fastapi"),
        requirement("redis"),
        requirement("opentelemetry-exporter-otlp"),
        requirement("opentelemetry-instrumentation-fastapi"),
        requirement("opentelemetry-sdk"),
        requirement("uvicorn"),
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:version",
        "//src/service/agent:helpers",
        "//src/service/core/app",
        "//src/service/core/auth",
        "//src/service/core/config",
        "//src/service/core/data",
        "//src/service/core/profile",
        "//src/service/core/workflow",
        "//src/service/logger:ctrl_websocket",
    ],
    data = [
        "//src/lib/utils:version.yaml",
    ],
    visibility = ["//src/service:__subpackages__"],
)

osmo_py_binary(
    name = "service_binary",
    main = "service.py",
    srcs = ["service.py"],
    deps = [":service_lib"],
)

py_image_layer(
    name = "service_layer",
    binary = ":service_binary",
)

osmo_python_wrapper(
    name = "service_wrapper",
    bin_name = "service",
    main = "/src/service/core/service.py",
    runfiles_dir = "/src/service/core/service_binary.runfiles",
)

filegroup(
    name = "service_image_layers",
    srcs = [
        ":service_layer_default",
        ":service_layer_packages",
        ":service_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "service_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":service_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "service_image_load_x86_64",
    image = ":service_image_x86_64",
    repo_tags = ["osmo.local/service:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "service_push_x86_64",
    image = ":service_image_x86_64",
    repository = BASE_IMAGE_URL + "service",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "service_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":service_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "service_image_load_arm64",
    image = ":service_image_arm64",
    repo_tags = ["osmo.local/service:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "service_push_arm64",
    image = ":service_image_arm64",
    repository = BASE_IMAGE_URL + "service",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
