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
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

go_library(
    name = "controller_lib",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/controller",
    visibility = ["//visibility:private"],
    deps = [
        "//src/apis/workflow/v1alpha1",
        "//src/controller/dispatcher",
        "//src/controller/kai",
        "//src/controller/periodic",
        "//src/controller/runner",
        "@io_k8s_client_go//dynamic",
        "@io_k8s_client_go//kubernetes",
        "@io_k8s_client_go//rest",
        "@io_k8s_client_go//tools/clientcmd",
    ],
)

################
#    x86_64    #
################

go_binary(
    name = "taskgroup_controller_x86_64",
    basename = "taskgroup_controller",
    embed = [":controller_lib"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

pkg_tar(
    name = "taskgroup_controller_x86_64_pkg",
    srcs = [":taskgroup_controller_x86_64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_image(
    name = "taskgroup_controller_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":taskgroup_controller_x86_64_pkg"],
    entrypoint = ["/usr/local/bin/taskgroup_controller"],
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
    name = "taskgroup_controller_arm64",
    basename = "taskgroup_controller",
    embed = [":controller_lib"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

pkg_tar(
    name = "taskgroup_controller_arm64_pkg",
    srcs = [":taskgroup_controller_arm64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_image(
    name = "taskgroup_controller_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":taskgroup_controller_arm64_pkg"],
    entrypoint = ["/usr/local/bin/taskgroup_controller"],
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
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
