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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL")

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
        "//src/utils/progress_check",
        "//src/service/core/auth",
        "//src/service/core/workflow",
        "//src/utils:static_config",
        "//src/utils/job",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "logger",
    srcs = ["logger.py"],
    main = "logger.py",
    deps = [":logger_lib"],
)


run_binary(
    name = "logger_onedir",
    args = [
        "--name osmo-logger",
        "--main $(location :logger.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/service/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_logger_onedir"],
    tool = "//src/service/builder:service_builder",
    srcs = [
        ":logger_lib",
        "logger.py",
        "//src/service/builder:extra_hooks",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
    ]
)

pkg_tar(
    name = "logger_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_logger_onedir": ".",
    },
    srcs = [":logger_onedir"],
    symlinks = {
        "/usr/bin/logger": "/osmo/osmo-logger/osmo-logger",
    },
    mode = "0755",
)

################
#    x86_64    #
################

oci_image(
    name = "logger_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":logger_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "logger_image_load_x86_64",
    image = ":logger_image_x86_64",
    repo_tags = ["osmo.local/logger:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "logger_push_x86_64",
    image = ":logger_image_x86_64",
    repository = BASE_IMAGE_URL + "logger",
    visibility = ["//visibility:public"],
    tags = ["manual"],
)

###############
#    arm64    #
###############

oci_image(
    name = "logger_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":logger_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    tags = ["arm64"],
)

oci_load(
    name = "logger_image_load_arm64",
    image = ":logger_image_arm64",
    repo_tags = ["osmo.local/logger:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "logger_push_arm64",
    image = ":logger_image_arm64",
    repository = BASE_IMAGE_URL + "logger",
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
