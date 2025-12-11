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

load("@aspect_rules_py//py:defs.bzl", "py_image_layer")
load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

osmo_py_library(
    name = "ctrl_websocket",
    srcs = ["ctrl_websocket.py"],
    deps = [
        requirement("fastapi"),
        requirement("redis"),
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
        "//src/lib/data/storage",
        "//src/service/core/auth",
        "//src/utils/job",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "logger_lib",
    srcs = ["logger.py"],
    deps = [
        ":ctrl_websocket",
        requirement("fastapi"),
        requirement("redis"),
        requirement("uvicorn"),
        "//src/lib/utils:logging",
        "//src/utils/progress_check:progress_check_lib",
        "//src/service/core/auth",
        "//src/service/core/workflow",
        "//src/utils:static_config",
        "//src/utils/job",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "logger_binary",
    srcs = ["logger.py"],
    main = "logger.py",
    deps = [
        ":logger_lib",
    ],
)

py_image_layer(
    name = "logger_layer",
    binary = ":logger_binary",
)

osmo_python_wrapper(
    name = "logger_wrapper",
    bin_name = "logger",
    main = "/src/service/logger/logger.py",
    runfiles_dir = "/src/service/logger/logger_binary.runfiles",
)

filegroup(
    name = "logger_image_layers",
    srcs = [
        ":logger_layer_default",
        ":logger_layer_packages",
        ":logger_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "logger_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":logger_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "logger_image_load_x86_64",
    image = ":logger_image_x86_64",
    repo_tags = ["osmo.local/logger:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "logger_push_x86_64",
    image = ":logger_image_x86_64",
    repository = BASE_IMAGE_URL + "logger",
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
    name = "logger_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":logger_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "logger_image_load_arm64",
    image = ":logger_image_arm64",
    repo_tags = ["osmo.local/logger:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "logger_push_arm64",
    image = ":logger_image_arm64",
    repository = BASE_IMAGE_URL + "logger",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
