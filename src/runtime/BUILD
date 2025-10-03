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
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")


###################################
# Osmo init Pyinstaller Packaging #
###################################

osmo_py_library(
    name = "init",
    srcs = ["init.py"],
    deps = [
        requirement("pydantic"),
    ],
)

osmo_py_binary(
    name = "builder",
    main = "builder.py",
    srcs = ["builder.py"],
    deps = [
        requirement("pyinstaller"),
        ":init",
    ],
)

run_binary(
    name = "init_onedir",
    args = [
        "--output_dir $(@D)",
        "--main $(location :init.py)",
    ],
    out_dirs = ["osmo_init_onedir"],
    tool = ":builder",
    srcs = [
        "init.py",
        ":init",
    ],
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "init_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_init_onedir": ".",
    },
    srcs = [":init_onedir"],
    symlinks = {
        "/usr/bin/osmo_init": "/osmo/osmo-init/osmo-init",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
# x86_64 image #
################

oci_image(
    name = "init_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":init_onedir_pkg",
        "//src/cli:osmo_cli_pkg_amd64",
        "//src/runtime/cmd/ctrl:osmo_ctrl_x86_64_pkg",
        "//src/runtime/cmd/user:osmo_exec_x86_64_pkg",
        "//src/runtime/cmd/rsync:rsync_x86_64_pkg",
    ],
    workdir = "/osmo",
    visibility = ["//visibility:public"],
)

# Local image testing only
oci_load(
    name = "init_image_load_x86_64",
    image = ":init_image_x86_64",
    repo_tags = ["init_image_x86_64:latest"],
    tags = ["manual"],
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
)

################
# ARM 64 image #
################

oci_image(
    name = "init_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":init_onedir_pkg",
        "//src/cli:osmo_cli_pkg_arm64",
        "//src/runtime/cmd/ctrl:osmo_ctrl_arm64_pkg",
        "//src/runtime/cmd/user:osmo_exec_arm64_pkg",
        "//src/runtime/cmd/rsync:rsync_arm64_pkg",
    ],
    workdir = "/osmo",
    tags = ["arm64"],
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
        "arm64",
        "manual",
    ],
)
