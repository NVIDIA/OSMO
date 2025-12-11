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
load("//bzl:py.bzl", "osmo_py_binary", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

osmo_py_binary(
    name = "init",
    main = "init.py",
    srcs = ["init.py"],
)

py_image_layer(
    name = "init_layer",
    binary = ":init",
)

# Create a wrapper that uses system Python and sets up PYTHONPATH
osmo_python_wrapper(
    name = "init_wrapper",
    bin_name = "osmo_init",
    main = "/src/runtime/init.py",
    runfiles_dir = "/src/runtime/init.runfiles",
)

filegroup(
    name = "init_image_layers",
    srcs = [
        ":init_layer_default",
        ":init_layer_packages",
        ":init_wrapper",
    ],
)

################
# x86_64 image #
################

oci_image(
    name = "init_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":init_image_layers",
        "//src/cli:osmo_cli_pkg_amd64",
        "//src/runtime/cmd/ctrl:osmo_ctrl_x86_64_pkg",
        "//src/runtime/cmd/user:osmo_exec_x86_64_pkg",
        "//src/runtime/cmd/rsync:rsync_x86_64_pkg",
    ],
    workdir = "/osmo",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

# Local image testing only
oci_load(
    name = "init_image_load_x86_64",
    image = ":init_image_x86_64",
    repo_tags = ["init_image_x86_64:latest"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "init_push_x86_64",
    image = ":init_image_x86_64",
    repository = BASE_IMAGE_URL + "init-container",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

################
# ARM 64 image #
################

oci_image(
    name = "init_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":init_image_layers",
        "//src/cli:osmo_cli_pkg_arm64",
        "//src/runtime/cmd/ctrl:osmo_ctrl_arm64_pkg",
        "//src/runtime/cmd/user:osmo_exec_arm64_pkg",
        "//src/runtime/cmd/rsync:rsync_arm64_pkg",
    ],
    workdir = "/osmo",
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
    visibility = ["//visibility:public"],
)

# Local image testing only
oci_load(
    name = "init_image_load_arm64",
    image = ":init_image_arm64",
    repo_tags = ["init_image_arm64:latest"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "init_push_arm64",
    image = ":init_image_arm64",
    repository = BASE_IMAGE_URL + "init-container",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
