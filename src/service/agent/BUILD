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
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL")

osmo_py_library(
    name = "agent_service_lib",
    srcs = [
        "agent_service.py",
    ],
    deps = [
        ":helpers",
        requirement("fastapi"),
        requirement("uvicorn"),
        "//src/utils:backend_messages",
        "//src/utils/metrics",
        "//src/utils/progress_check",
        "//src/service/core/auth",
        "//src/service/core/config",
        "//src/service/core/workflow",
    ],
    visibility = ["//src/service:__subpackages__"],
)

osmo_py_binary(
    name = "agent_service",
    main = "agent_service.py",
    srcs = ["agent_service.py"],
    deps = [":agent_service_lib"],
)

osmo_py_library(
    name = "helpers",
    srcs = [
        "objects.py",
        "helpers.py",
    ],
    deps = [
        requirement("fastapi"),
        requirement("kombu"),
        requirement("pydantic"),
        requirement("redis"),
        requirement("websockets"),
        "//src/lib/utils:cache",
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/service/core/config",
        "//src/utils/metrics",
        "//src/utils/job",
        "//src/utils/job:backend_job",
        "//src/utils/progress_check",
    ],
    visibility = ["//src/service:__subpackages__"],
)


run_binary(
    name = "agent_service_onedir",
    args = [
        "--name osmo-agent-service",
        "--main $(location :agent_service.py)",
        "--output_dir $(@D)",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/service/builder:extra_hooks)",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_agent_service_onedir"],
    tool = "//src/service/builder:service_builder",
    srcs = [
        ":agent_service_lib",
        "agent_service.py",
        "//src/service/builder:extra_hooks",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/utils:version.yaml",
    ]
)

pkg_tar(
    name = "agent_service_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_agent_service_onedir": ".",
    },
    srcs = [":agent_service_onedir"],
    symlinks = {
        "/usr/bin/agent_service": "/osmo/osmo-agent-service/osmo-agent-service",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

oci_image(
    name = "agent_service_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [
        ":agent_service_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
)

oci_load(
    name = "agent_service_image_load_x86_64",
    image = ":agent_service_image_x86_64",
    repo_tags = ["osmo.local/agent:latest-x86_64"],
    tags = ["manual"],
)

oci_push(
    name = "agent_service_push_x86_64",
    image = ":agent_service_image_x86_64",
    repository = BASE_IMAGE_URL + "agent",
    visibility = ["//visibility:public"],
    tags = ["manual"],
)

###############
#    arm64    #
###############

oci_image(
    name = "agent_service_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [
        ":agent_service_onedir_pkg",
        "//src/utils/progress_check:progress_check_onedir_pkg",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

oci_load(
    name = "agent_service_image_load_arm64",
    image = ":agent_service_image_arm64",
    repo_tags = ["osmo.local/agent:latest-arm64"],
    tags = ["manual", "arm64"],
)

oci_push(
    name = "agent_service_push_arm64",
    image = ":agent_service_image_arm64",
    repository = BASE_IMAGE_URL + "agent",
    visibility = ["//visibility:public"],
    tags = ["manual", "arm64"],
)
