# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library", "go_test")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

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
        "//src/utils/progress_check:progress_check_lib",
    ],
    visibility = ["//src/operator:__subpackages__"],
)

osmo_py_binary(
    name = "backend_listener_binary",
    main = "backend_listener.py",
    srcs = ["backend_listener.py"],
    deps = [":backend_listener_lib"],
)

py_image_layer(
    name = "backend_listener_layer",
    binary = ":backend_listener_binary",
)

osmo_python_wrapper(
    name = "backend_listener_wrapper",
    bin_name = "backend_listener",
    main = "/src/operator/backend_listener.py",
    runfiles_dir = "/src/operator/backend_listener_binary.runfiles",
)

filegroup(
    name = "backend_listener_image_layers",
    srcs = [
        ":backend_listener_layer_default",
        ":backend_listener_layer_packages",
        ":backend_listener_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "backend_listener_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":backend_listener_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "backend_listener_image_load_x86_64",
    image = ":backend_listener_image_x86_64",
    repo_tags = ["osmo.local/backend-listener:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
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
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "backend_listener_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":backend_listener_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "backend_listener_image_load_arm64",
    image = ":backend_listener_image_arm64",
    repo_tags = ["osmo.local/backend-listener:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "backend_listener_push_arm64",
    image = ":backend_listener_image_arm64",
    repository = BASE_IMAGE_URL + "backend-listener",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
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
        "//src/utils/progress_check:progress_check_lib",
    ],
    visibility = ["//src/operator:__subpackages__"],
)

osmo_py_binary(
    name = "backend_worker_binary",
    main = "backend_worker.py",
    srcs = ["backend_worker.py"],
    deps = [":backend_worker_lib"],
)

py_image_layer(
    name = "backend_worker_layer",
    binary = ":backend_worker_binary",
)

osmo_python_wrapper(
    name = "backend_worker_wrapper",
    bin_name = "backend_worker",
    main = "/src/operator/backend_worker.py",
    runfiles_dir = "/src/operator/backend_worker_binary.runfiles",
)

filegroup(
    name = "backend_worker_image_layers",
    srcs = [
        ":backend_worker_layer_default",
        ":backend_worker_layer_packages",
        ":backend_worker_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "backend_worker_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":backend_worker_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "backend_worker_image_load_x86_64",
    image = ":backend_worker_image_x86_64",
    repo_tags = ["osmo.local/backend-worker:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
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
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "backend_worker_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":backend_worker_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "backend_worker_image_load_arm64",
    image = ":backend_worker_image_arm64",
    repo_tags = ["osmo.local/backend-worker:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "backend_worker_push_arm64",
    image = ":backend_worker_image_arm64",
    repository = BASE_IMAGE_URL + "backend-worker",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

################################################################
#                    Workflow Listener                         #
################################################################

go_library(
    name = "workflow_listener_lib",
    srcs = [
        "main.go",
        "workflow_listener.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/operator",
    visibility = ["//src/operator:__subpackages__"],
    deps = [
        "//src/lib/utils:utils",
        "//src/operator/utils:utils",
        "//src/proto/compute_connector:compute_connector_go_proto",
        "//src/utils/progress_check:progress_writer",
        "@com_github_google_uuid//:uuid",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
        "@io_k8s_client_go//informers",
        "@io_k8s_client_go//tools/cache",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//credentials/insecure",
        "@org_golang_google_grpc//metadata",
        "@org_golang_google_protobuf//encoding/protojson",
    ],
)

go_test(
    name = "workflow_listener_test",
    srcs = ["workflow_listener_test.go"],
    embed = [":workflow_listener_lib"],
    deps = [
        "//src/operator/utils:utils",
        "//src/proto/compute_connector:compute_connector_go_proto",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
    ],
)

################
#    x86_64    #
################

go_binary(
    name = "workflow_listener_x86_64",
    basename = "workflow_listener",
    embed = [":workflow_listener_lib"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

pkg_tar(
    name = "workflow_listener_x86_64_pkg",
    srcs = [":workflow_listener_x86_64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_image(
    name = "workflow_listener_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":workflow_listener_x86_64_pkg"],
    entrypoint = ["/usr/local/bin/workflow_listener"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "workflow_listener_image_load_x86_64",
    image = ":workflow_listener_image_x86_64",
    repo_tags = ["osmo.local/workflow-listener:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "workflow_listener_push_x86_64",
    image = ":workflow_listener_image_x86_64",
    repository = BASE_IMAGE_URL + "workflow-listener",
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

go_binary(
    name = "workflow_listener_arm64",
    basename = "workflow_listener",
    embed = [":workflow_listener_lib"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

pkg_tar(
    name = "workflow_listener_arm64_pkg",
    srcs = [":workflow_listener_arm64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_image(
    name = "workflow_listener_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":workflow_listener_arm64_pkg"],
    entrypoint = ["/usr/local/bin/workflow_listener"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "workflow_listener_image_load_arm64",
    image = ":workflow_listener_image_arm64",
    repo_tags = ["osmo.local/workflow-listener:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "workflow_listener_push_arm64",
    image = ":workflow_listener_image_arm64",
    repository = BASE_IMAGE_URL + "workflow-listener",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
