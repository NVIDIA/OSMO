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
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL")

osmo_py_library(
    name = "backend_test_runner_lib",
    srcs = [
        "backend_test_runner.py",
        "daemonset_manager.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("opentelemetry-exporter-otlp"),
        requirement("opentelemetry-instrumentation-fastapi"),
        requirement("opentelemetry-sdk"),
        "//src/lib/utils:logging",
        "//src/operator/utils:login",
        "//src/operator/utils/node_validation_test:test_base",
        "//src/utils/metrics",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "backend_test_runner",
    srcs = ["backend_test_runner.py"],
    main = "backend_test_runner.py",
    deps = [
        ":backend_test_runner_lib",
    ],
)

run_binary(
    name = "backend_test_runner_onedir",
    args = [
        "--name osmo-backend-test-runner",
        "--main $(location :backend_test_runner.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/operator/builder:extra_hooks)",
    ],
    out_dirs = ["osmo_backend_test_runner_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":backend_test_runner_lib",
        "backend_test_runner.py",
        "//src/lib/utils:version.yaml",
        "//src/operator/builder:extra_hooks",
    ]
)

pkg_tar(
    name = "backend_test_runner_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_backend_test_runner_onedir": ".",
    },
    srcs = [":backend_test_runner_onedir"],
    symlinks = {
        "/usr/bin/backend_test_runner": "/osmo/osmo-backend-test-runner/osmo-backend-test-runner",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)


################
#    x86_64    #
################

oci_image(
    name = "backend_test_runner_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":backend_test_runner_onedir_pkg"],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "backend_test_runner_image_load_x86_64",
    image = ":backend_test_runner_image_x86_64",
    repo_tags = ["osmo.local/backend_test_runner:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "backend_test_runner_push_x86_64",
    image = ":backend_test_runner_image_x86_64",
    repository = BASE_IMAGE_URL + "backend-test-runner",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "backend_test_runner_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":backend_test_runner_onedir_pkg"],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "backend_test_runner_image_load_arm64",
    image = ":backend_test_runner_image_arm64",
    repo_tags = ["osmo.local/backend_test_runner:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "backend_test_runner_push_arm64",
    image = ":backend_test_runner_image_arm64",
    repository = BASE_IMAGE_URL + "backend-test-runner",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
        "arm64",
    ],
)
