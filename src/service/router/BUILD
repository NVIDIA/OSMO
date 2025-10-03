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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
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
    name = "router",
    main = "router.py",
    srcs = ["router.py"],
    deps = [":router_lib"],
)


run_binary(
    name = "router_onedir",
    args = [
        "--name osmo-router",
        "--main $(location :router.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/service/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_router_onedir"],
    tool = "//src/service/builder:service_builder",
    srcs = [
        ":router_lib",
        "router.py",
        "//src/service/builder:extra_hooks",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
    ]
)

pkg_tar(
    name = "router_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_router_onedir": ".",
    },
    srcs = [":router_onedir"],
    symlinks = {
        "/usr/bin/router": "/osmo/osmo-router/osmo-router",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "router_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":router_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "router_image_load_x86_64",
    image = ":router_image_x86_64",
    repo_tags = ["osmo.local/router:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "router_push_x86_64",
    image = ":router_image_x86_64",
    repository = BASE_IMAGE_URL + "router",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
)

###############
#    arm64    #
###############

oci_image(
    name = "router_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":router_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "router_image_load_arm64",
    image = ":router_image_arm64",
    repo_tags = ["osmo.local/router:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "router_push_arm64",
    image = ":router_image_arm64",
    repository = BASE_IMAGE_URL + "router",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
