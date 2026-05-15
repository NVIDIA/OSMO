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

load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

go_library(
    name = "cmd",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/controller/taskgroup/cmd",
    visibility = ["//visibility:private"],
    deps = [
        "//src/apis/taskgroup/v1alpha1",
        "//src/controller/taskgroup",
        "@io_k8s_api//core/v1:go_default_library",
        "@io_k8s_apimachinery//pkg/runtime:go_default_library",
        "@io_k8s_apimachinery//pkg/util/runtime:go_default_library",
        "@io_k8s_client_go//kubernetes:kubernetes",
        "@io_k8s_client_go//kubernetes/scheme:go_default_library",
        "@io_k8s_sigs_controller_runtime//:controller-runtime",
        "@io_k8s_sigs_controller_runtime//pkg/healthz:healthz",
        "@io_k8s_sigs_controller_runtime//pkg/metrics/server:server",
    ],
)

go_binary(
    name = "taskgroup_controller_bin_x86_64",
    basename = "taskgroup_controller",
    embed = [":cmd"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

pkg_tar(
    name = "taskgroup_controller_pkg_x86_64",
    package_dir = "/usr/local/bin",
    srcs = [":taskgroup_controller_bin_x86_64"],
    mode = "0755",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_image(
    name = "taskgroup_controller_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    entrypoint = ["/usr/local/bin/taskgroup_controller"],
    tars = [":taskgroup_controller_pkg_x86_64"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "taskgroup_controller_image_load_x86_64",
    image = ":taskgroup_controller_image_x86_64",
    repo_tags = ["osmo.local/taskgroup-controller:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "taskgroup_controller_push_x86_64",
    image = ":taskgroup_controller_image_x86_64",
    repository = BASE_IMAGE_URL + "taskgroup-controller",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    tags = ["manual"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

go_binary(
    name = "taskgroup_controller_bin_arm64",
    basename = "taskgroup_controller",
    embed = [":cmd"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

pkg_tar(
    name = "taskgroup_controller_pkg_arm64",
    package_dir = "/usr/local/bin",
    srcs = [":taskgroup_controller_bin_arm64"],
    mode = "0755",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_image(
    name = "taskgroup_controller_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    entrypoint = ["/usr/local/bin/taskgroup_controller"],
    tars = [":taskgroup_controller_pkg_arm64"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "taskgroup_controller_image_load_arm64",
    image = ":taskgroup_controller_image_arm64",
    repo_tags = ["osmo.local/taskgroup-controller:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "taskgroup_controller_push_arm64",
    image = ":taskgroup_controller_image_arm64",
    repository = BASE_IMAGE_URL + "taskgroup-controller",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    tags = ["manual"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
