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
        "//src/utils/progress_check:progress_check_lib",
    ],
    data = [
        "//src/lib/utils:version.yaml",
        "//src/utils/resources:email_notification.html",
        "//src/utils/resources:osmo_logo.png",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "worker_binary",
    srcs = ["worker.py"],
    main = "worker.py",
    deps = [":worker_lib"],
)

py_image_layer(
    name = "worker_layer",
    binary = ":worker_binary",
)

osmo_python_wrapper(
    name = "worker_wrapper",
    bin_name = "worker",
    main = "/src/service/worker/worker.py",
    runfiles_dir = "/src/service/worker/worker_binary.runfiles",
)

filegroup(
    name = "worker_image_layers",
    srcs = [
        ":worker_layer_default",
        ":worker_layer_packages",
        ":worker_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "worker_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":worker_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "worker_image_load_x86_64",
    image = ":worker_image_x86_64",
    repo_tags = ["osmo.local/worker:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "worker_push_x86_64",
    image = ":worker_image_x86_64",
    repository = BASE_IMAGE_URL + "worker",
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
    name = "worker_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":worker_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "worker_image_load_arm64",
    image = ":worker_image_arm64",
    repo_tags = ["osmo.local/worker:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "worker_push_arm64",
    image = ":worker_image_arm64",
    repository = BASE_IMAGE_URL + "worker",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
