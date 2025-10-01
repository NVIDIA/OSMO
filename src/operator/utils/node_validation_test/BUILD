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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_py_test")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL")

# Base library for test functionality
osmo_py_library(
    name = "test_base",
    srcs = [
        "test_base.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:common",
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

#########################################################
#                  Resource Validator                   #
#########################################################

osmo_py_library(
    name = "resource_validator_lib",
    srcs = [
        "resource_validator.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("urllib3"),
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        ":test_base",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "resource_validator",
    srcs = ["resource_validator.py"],
    main = "resource_validator.py",
    deps = [
        ":resource_validator_lib",
    ],
)



run_binary(
    name = "resource_validator_onedir",
    args = [
        "--name osmo-resource-validator",
        "--main $(location :resource_validator.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
    ],
    out_dirs = ["osmo_resource_validator_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":resource_validator_lib",
        "resource_validator.py",
        "//src/lib/utils:version.yaml",
    ]
)


pkg_tar(
    name = "resource_validator_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_resource_validator_onedir": ".",
    },
    srcs = [":resource_validator_onedir"],
    symlinks = {
        "/usr/bin/resource_validator": "/osmo/osmo-resource-validator/osmo-resource-validator",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)


################
#    x86_64    #
################

oci_image(
    name = "resource_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":resource_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "resource_validator_image_load_x86_64",
    image = ":resource_validator_image_x86_64",
    repo_tags = ["osmo.local/resource-validator:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "resource_validator_push_x86_64",
    image = ":resource_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "resource-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "resource_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":resource_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "resource_validator_image_load_arm64",
    image = ":resource_validator_image_arm64",
    repo_tags = ["osmo.local/resource-validator:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "resource_validator_push_arm64",
    image = ":resource_validator_image_arm64",
    repository = BASE_IMAGE_URL + "resource-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
        "arm64",
    ],
)

#########################################################
#                     LFS Validator                     #
#########################################################

osmo_py_library(
    name = "lfs_validator_lib",
    srcs = [
        "lfs_validator.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("urllib3"),
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        ":test_base",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "lfs_validator",
    srcs = ["lfs_validator.py"],
    main = "lfs_validator.py",
    deps = [
        ":lfs_validator_lib",
    ],
)



run_binary(
    name = "lfs_validator_onedir",
    args = [
        "--name osmo-lfs-validator",
        "--main $(location :lfs_validator.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
    ],
    out_dirs = ["osmo_lfs_validator_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":lfs_validator_lib",
        "lfs_validator.py",
        "//src/lib/utils:version.yaml",
    ]
)


pkg_tar(
    name = "lfs_validator_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_lfs_validator_onedir": ".",
    },
    srcs = [":lfs_validator_onedir"],
    symlinks = {
        "/usr/bin/lfs_validator": "/osmo/osmo-lfs-validator/osmo-lfs-validator",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "lfs_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":lfs_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "lfs_validator_image_load_x86_64",
    image = ":lfs_validator_image_x86_64",
    repo_tags = ["osmo.local/lfs-validator:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "lfs_validator_push_x86_64",
    image = ":lfs_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "lfs-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "lfs_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":lfs_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "lfs_validator_image_load_arm64",
    image = ":lfs_validator_image_arm64",
    repo_tags = ["osmo.local/lfs-validator:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "lfs_validator_push_arm64",
    image = ":lfs_validator_image_arm64",
    repository = BASE_IMAGE_URL + "lfs-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
        "arm64",
    ],
)

#########################################################
#                  Connection Validator                 #
#########################################################

osmo_py_library(
    name = "connection_validator_lib",
    srcs = [
        "connection_validator.py",
    ],
    data = [
        "connection_validator.yaml",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("urllib3"),
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        ":test_base",
    ],
    visibility = ["//src/operator:__subpackages__"],
)

# connection validator binary
osmo_py_binary(
    name = "connection_validator",
    srcs = ["connection_validator.py"],
    main = "connection_validator.py",
    deps = [
        ":connection_validator_lib",
    ],
)


run_binary(
    name = "connection_validator_onedir",
    args = [
        "--name osmo-connection-validator",
        "--main $(location :connection_validator.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--add-data $(location :connection_validator.yaml):.",
    ],
    out_dirs = ["osmo_connection_validator_onedir"],
    tool = "//src/operator/builder:service_builder",
    srcs = [
        ":connection_validator_lib",
        "//src/lib/utils:version.yaml",
        ":connection_validator.yaml",
        "connection_validator.py",
    ]
)


pkg_tar(
    name = "connection_validator_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_connection_validator_onedir": ".",
    },
    srcs = [":connection_validator_onedir"],
    symlinks = {
        "/usr/bin/connection_validator": "/osmo/osmo-connection-validator/osmo-connection-validator",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)


################
#    x86_64    #
################

oci_image(
    name = "connection_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":connection_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "connection_validator_image_load_x86_64",
    image = ":connection_validator_image_x86_64",
    repo_tags = ["osmo.local/connection-validator:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "connection_validator_push_x86_64",
    image = ":connection_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "connection-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "connection_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":connection_validator_onedir_pkg"],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "connection_validator_image_load_arm64",
    image = ":connection_validator_image_arm64",
    repo_tags = ["osmo.local/connection-validator:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "connection_validator_push_arm64",
    image = ":connection_validator_image_arm64",
    repository = BASE_IMAGE_URL + "connection-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
        "arm64",
    ],
)
