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
load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_py_test", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
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
    name = "resource_validator_binary",
    srcs = ["resource_validator.py"],
    main = "resource_validator.py",
    deps = [
        ":resource_validator_lib",
    ],
)

py_image_layer(
    name = "resource_validator_layer",
    binary = ":resource_validator_binary",
)

osmo_python_wrapper(
    name = "resource_validator_wrapper",
    bin_name = "resource_validator",
    main = "/src/operator/utils/node_validation_test/resource_validator.py",
    runfiles_dir = "/src/operator/utils/node_validation_test/resource_validator_binary.runfiles",
)

filegroup(
    name = "resource_validator_image_layers",
    srcs = [
        ":resource_validator_layer_default",
        ":resource_validator_layer_packages",
        ":resource_validator_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "resource_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":resource_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "resource_validator_image_load_x86_64",
    image = ":resource_validator_image_x86_64",
    repo_tags = ["osmo.local/resource-validator:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "resource_validator_push_x86_64",
    image = ":resource_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "resource-validator",
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
    name = "resource_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":resource_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "resource_validator_image_load_arm64",
    image = ":resource_validator_image_arm64",
    repo_tags = ["osmo.local/resource-validator:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "resource_validator_push_arm64",
    image = ":resource_validator_image_arm64",
    repository = BASE_IMAGE_URL + "resource-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
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
    name = "lfs_validator_binary",
    srcs = ["lfs_validator.py"],
    main = "lfs_validator.py",
    deps = [
        ":lfs_validator_lib",
    ],
)

py_image_layer(
    name = "lfs_validator_layer",
    binary = ":lfs_validator_binary",
)

osmo_python_wrapper(
    name = "lfs_validator_wrapper",
    bin_name = "lfs_validator",
    main = "/src/operator/utils/node_validation_test/lfs_validator.py",
    runfiles_dir = "/src/operator/utils/node_validation_test/lfs_validator_binary.runfiles",
)

filegroup(
    name = "lfs_validator_image_layers",
    srcs = [
        ":lfs_validator_layer_default",
        ":lfs_validator_layer_packages",
        ":lfs_validator_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "lfs_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":lfs_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "lfs_validator_image_load_x86_64",
    image = ":lfs_validator_image_x86_64",
    repo_tags = ["osmo.local/lfs-validator:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "lfs_validator_push_x86_64",
    image = ":lfs_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "lfs-validator",
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
    name = "lfs_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":lfs_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "lfs_validator_image_load_arm64",
    image = ":lfs_validator_image_arm64",
    repo_tags = ["osmo.local/lfs-validator:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "lfs_validator_push_arm64",
    image = ":lfs_validator_image_arm64",
    repository = BASE_IMAGE_URL + "lfs-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
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
    name = "connection_validator_binary",
    srcs = ["connection_validator.py"],
    main = "connection_validator.py",
    deps = [
        ":connection_validator_lib",
    ],
)

py_image_layer(
    name = "connection_validator_layer",
    binary = ":connection_validator_binary",
)

osmo_python_wrapper(
    name = "connection_validator_wrapper",
    bin_name = "connection_validator",
    main = "/src/operator/utils/node_validation_test/connection_validator.py",
    runfiles_dir = "/src/operator/utils/node_validation_test/connection_validator_binary.runfiles",
)

filegroup(
    name = "connection_validator_image_layers",
    srcs = [
        ":connection_validator_layer_default",
        ":connection_validator_layer_packages",
        ":connection_validator_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "connection_validator_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":connection_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "connection_validator_image_load_x86_64",
    image = ":connection_validator_image_x86_64",
    repo_tags = ["osmo.local/connection-validator:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "connection_validator_push_x86_64",
    image = ":connection_validator_image_x86_64",
    repository = BASE_IMAGE_URL + "connection-validator",
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
    name = "connection_validator_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":connection_validator_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "connection_validator_image_load_arm64",
    image = ":connection_validator_image_arm64",
    repo_tags = ["osmo.local/connection-validator:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "connection_validator_push_arm64",
    image = ":connection_validator_image_arm64",
    repository = BASE_IMAGE_URL + "connection-validator",
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
