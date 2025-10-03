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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

################################################################
#                      Backend Listener                        #
################################################################

osmo_py_library(
    name = "backend_listener_lib",
    srcs = [
        "backend_listener.py",
        "helpers.py"
    ],
    deps = [
        requirement("kubernetes"),
        requirement("opentelemetry-exporter-otlp"),
        requirement("opentelemetry-instrumentation-fastapi"),
        requirement("opentelemetry-sdk"),
        requirement("pydantic"),
        requirement("requests"),
        requirement("urllib3"),
        requirement("websockets"),
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:version",
        "//src/operator/utils:login",
        "//src/utils:backend_messages",
        "//src/utils/connectors",
        "//src/utils/job",
        "//src/utils/metrics",
        "//src/utils/progress_check",
    ],
    visibility = ["//src/operator:__subpackages__"],
)

osmo_py_binary(
    name = "backend_listener",
    main = "backend_listener.py",
    srcs = ["backend_listener.py"],
    deps = [":backend_listener_lib"],
)

run_binary(
    name = "backend_listener_onedir",
    args = [
        "--name osmo-backend-listener",
        "--main $(location :backend_listener.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/operator/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_backend_listener_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":backend_listener_lib",
        "backend_listener.py",
        "//src/operator/builder:extra_hooks",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
    ],
)

pkg_tar(
    name = "backend_listener_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_backend_listener_onedir": ".",
    },
    srcs = [":backend_listener_onedir"],
    symlinks = {
        "/usr/bin/backend_listener": "/osmo/osmo-backend-listener/osmo-backend-listener",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "backend_listener_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":backend_listener_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "backend_listener_image_load_x86_64",
    image = ":backend_listener_image_x86_64",
    repo_tags = ["osmo.local/backend-listener:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "backend_listener_push_x86_64",
    image = ":backend_listener_image_x86_64",
    repository = BASE_IMAGE_URL + "backend-listener",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "backend_listener_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":backend_listener_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "backend_listener_image_load_arm64",
    image = ":backend_listener_image_arm64",
    repo_tags = ["osmo.local/backend-listener:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "backend_listener_push_arm64",
    image = ":backend_listener_image_arm64",
    repository = BASE_IMAGE_URL + "backend-listener",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)

##############################################################
#                      Backend Worker                        #
##############################################################

osmo_py_library(
    name = "backend_worker_lib",
    srcs = [
        "backend_worker.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("websockets"),
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:version",
        "//src/operator/utils:login",
        "//src/utils:backend_messages",
        "//src/utils/metrics",
        "//src/utils/job:backend_job",
        "//src/utils/progress_check",
    ],
    visibility = ["//src/operator:__subpackages__"],
)

osmo_py_binary(
    name = "backend_worker",
    main = "backend_worker.py",
    srcs = ["backend_worker.py"],
    deps = [":backend_worker_lib"],
)

run_binary(
    name = "backend_worker_onedir",
    args = [
        "--name osmo-backend-worker",
        "--main $(location :backend_worker.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/operator/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_backend_worker_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":backend_worker_lib",
        "backend_worker.py",
        "//src/operator/builder:extra_hooks",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
    ]
)

pkg_tar(
    name = "backend_worker_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_backend_worker_onedir": ".",
    },
    srcs = [":backend_worker_onedir"],
    symlinks = {
        "/usr/bin/backend_worker": "/osmo/osmo-backend-worker/osmo-backend-worker",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "backend_worker_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":backend_worker_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "backend_worker_image_load_x86_64",
    image = ":backend_worker_image_x86_64",
    repo_tags = ["osmo.local/backend-worker:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "backend_worker_push_x86_64",
    image = ":backend_worker_image_x86_64",
    repository = BASE_IMAGE_URL + "backend-worker",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "backend_worker_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":backend_worker_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "backend_worker_image_load_arm64",
    image = ":backend_worker_image_arm64",
    repo_tags = ["osmo.local/backend-worker:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "backend_worker_push_arm64",
    image = ":backend_worker_image_arm64",
    repository = BASE_IMAGE_URL + "backend-worker",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
