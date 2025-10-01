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
    name = "worker_lib",
    srcs = [
        "worker.py",
    ],
    deps = [
        requirement("kombu"),
        requirement("redis"),
        requirement("opentelemetry-instrumentation-fastapi"),
        requirement("opentelemetry-sdk"),
        "//src/utils/metrics",
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/utils:static_config",
        "//src/utils/job",
        "//src/utils/progress_check",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "worker",
    srcs = ["worker.py"],
    main = "worker.py",
    deps = [":worker_lib"],
)

run_binary(
    name = "worker_onedir",
    args = [
        "--name osmo-worker",
        "--main $(location :worker.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--add-data $(location //src/utils/resources:email_notification.html):src/utils/resources/",
        "--add-data $(location //src/utils/resources:osmo_logo.png):src/utils/resources/",
        "--additional-hooks $(locations //src/service/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_worker_onedir"],
    tool = "//src/service/builder:service_builder",
    srcs = [
        ":worker_lib",
        "worker.py",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
        "//src/service/builder:extra_hooks",
        "//src/utils/resources:email_notification.html",
        "//src/utils/resources:osmo_logo.png",
    ],
)

pkg_tar(
    name = "worker_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_worker_onedir": ".",
    },
    srcs = [":worker_onedir"],
    symlinks = {
        "/usr/bin/worker": "/osmo/osmo-worker/osmo-worker",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "worker_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":worker_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "worker_image_load_x86_64",
    image = ":worker_image_x86_64",
    repo_tags = ["osmo.local/worker:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "worker_push_x86_64",
    image = ":worker_image_x86_64",
    repository = BASE_IMAGE_URL + "worker",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "worker_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":worker_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "worker_image_load_arm64",
    image = ":worker_image_arm64",
    repo_tags = ["osmo.local/worker:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "worker_push_arm64",
    image = ":worker_image_arm64",
    repository = BASE_IMAGE_URL + "worker",
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
