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
    name = "router_lib",
    srcs = [
        "router.py",
        "helper.py",
    ],
    deps = [
        requirement("fastapi"),
        requirement("pydantic"),
        requirement("uvicorn"),
        "//src/utils/connectors:connectors",
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:version",
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "router_binary",
    main = "router.py",
    srcs = ["router.py"],
    deps = [":router_lib"],
)

py_image_layer(
    name = "router_layer",
    binary = ":router_binary",
)

osmo_python_wrapper(
    name = "router_wrapper",
    bin_name = "router",
    main = "/src/service/router/router.py",
    runfiles_dir = "/src/service/router/router_binary.runfiles",
)

filegroup(
    name = "router_image_layers",
    srcs = [
        ":router_layer_default",
        ":router_layer_packages",
        ":router_wrapper",
    ],
)

################
#    x86_64    #
################

oci_image(
    name = "router_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":router_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "router_image_load_x86_64",
    image = ":router_image_x86_64",
    repo_tags = ["osmo.local/router:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "router_push_x86_64",
    image = ":router_image_x86_64",
    repository = BASE_IMAGE_URL + "router",
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

oci_image(
    name = "router_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":router_image_layers",
        "//src/utils/progress_check:progress_check_image_layers",
    ],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "router_image_load_arm64",
    image = ":router_image_arm64",
    repo_tags = ["osmo.local/router:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "router_push_arm64",
    image = ":router_image_arm64",
    repository = BASE_IMAGE_URL + "router",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
