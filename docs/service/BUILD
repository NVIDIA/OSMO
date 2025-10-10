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

load("@osmo_workspace//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_push", "oci_load")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

package(default_visibility = ["//visibility:public"])

osmo_py_library(
    name = "doc_service_lib",
    srcs = [
        "doc_service.py",
        "objects.py",
    ],
    deps = [
        requirement("fastapi"),
        requirement("pydantic"),
        requirement("uvicorn"),
        "@osmo_workspace//src/utils:static_config",
    ],
)

osmo_py_binary(
    name = "doc_service",
    main = "doc_service.py",
    srcs = ["doc_service.py"],
    deps = [":doc_service_lib"],
    args = ["--docs_dir", "$(location //docs:user_docs)"],
    data = [
        "//docs:user_docs",
        "//docs:deployment_docs",
    ],
)

osmo_py_binary(
    name = "builder",
    main = "builder.py",
    srcs = ["builder.py"],
    deps = [
        "@rules_python//python/runfiles",
        ":doc_service_lib",
        requirement("pyinstaller"),
    ],
)

run_binary(
    name = "doc_service_onedir_binary",
    args = [
        "--name osmo-doc-service",
        "--main $(location :doc_service.py)",
        "--output_dir $(@D)",
        "--add-data $(location //docs:user_docs):docs/user_docs",
        "--add-data $(location //docs:deployment_docs):docs/deployment_docs",
    ],
    out_dirs = ["doc_service_onedir"],
    tool = ":builder",
    srcs = [
        ":doc_service_lib",
        "doc_service.py",
        "//docs:user_docs",
        "//docs:deployment_docs",
    ],
)

pkg_tar(
    name = "doc_service_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/doc_service_onedir": ".",
    },
    srcs = [":doc_service_onedir_binary"],
)

################
#    x86_64    #
################

oci_image(
    name = "doc_service_image_x86_64",
    base = "@osmo_workspace//src:osmo_docker_distroless_image_amd64",
    entrypoint = ["/osmo/osmo-doc-service/osmo-doc-service"],
    tars = [
        ":doc_service_onedir_pkg",
    ],
)

oci_load(
    name = "docs_service_image_load_x86_64",
    image = ":doc_service_image_x86_64",
    repo_tags = ["osmo.local/docs:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "doc_service_push_x86_64",
    image = ":doc_service_image_x86_64",
    repository = BASE_IMAGE_URL + "docs",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

###############
#    arm64    #
###############

oci_image(
    name = "doc_service_image_arm64",
    base = "@osmo_workspace//src:osmo_docker_distroless_image_arm64",
    entrypoint = ["/osmo/osmo-doc-service/osmo-doc-service"],
    tars = [
        ":doc_service_onedir_pkg",
    ],
    tags = ["arm64"],
)

oci_load(
    name = "docs_service_image_load_arm64",
    image = ":doc_service_image_arm64",
    repo_tags = ["osmo.local/docs:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "doc_service_push_arm64",
    image = ":doc_service_image_arm64",
    repository = BASE_IMAGE_URL + "docs",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
