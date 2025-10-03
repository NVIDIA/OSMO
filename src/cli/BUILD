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
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

osmo_py_library(
    name = "cli_lib",
    srcs = [
        "app.py",
        "bucket.py",
        "data.py",
        "dataset.py",
        "login.py",
        "main_parser.py",
        "version.py",
        "workflow.py",
        "credential.py",
        "resources.py",
        "profile.py",
        "pool.py",
        "task.py",
        "access_token.py",
        "config.py",
        "editor.py",
    ],
    deps = [
        requirement("ijson"),
        requirement("pydantic"),
        requirement("pyyaml"),
        requirement("requests"),
        requirement("shtab"),
        requirement("tqdm"),
        requirement("websockets"),
        requirement("websocket-client"),
        "//src/lib/data",
        "//src/lib/rsync",
        "//src/lib/utils:client",
        "//src/lib/utils:client_configs",
        "//src/lib/utils:common",
        "//src/lib/utils:credentials",
        "//src/lib/utils:login",
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:priority",
        "//src/lib/utils:paths",
        "//src/lib/utils:port_forward",
        "//src/lib/utils:role",
        "//src/lib/utils:version",
        "//src/lib/utils:validation",
        "//src/lib/utils:workflow",
        "//src/lib/utils:config_history",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "cli",
    main = "cli.py",
    srcs = [
        "cli.py",
    ],
    deps = [
        ":cli_lib",
    ],
    visibility = ["//visibility:public"],
)

################
#    x86_64    #
################

osmo_py_binary(
    name = "cli_builder",
    main = "cli_builder.py",
    srcs = ["cli_builder.py"],
    deps = [
        ":cli_lib",
        requirement("pyinstaller"),
        requirement("shtab"),
    ]
)

run_binary(
    name = "cli_onedir_amd64",
    args = [
        "--output_dir $(@D)",
        "--main $(location :cli.py)",
        "--add-data $(location //src/lib/rsync:rsync_bin):src/lib/rsync/",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_cli_onedir_amd64"],
    tool = ":cli_builder",
    srcs = [
        "cli.py",
        ":cli_lib",
        "//src/lib/utils:version.yaml",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/rsync:rsync_bin",
    ],
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "osmo_cli_pkg_amd64",
    extension = "tgz",
    remap_paths = {
        "/osmo_cli_onedir_amd64": ".",
    },
    srcs = [":cli_onedir_amd64"],
    symlinks = {
        "osmo/osmo": "osmo-cli/osmo-cli",
    },
    package_dir = "/osmo/osmo_cli_onedir",
    visibility = ["//visibility:public"],
    mode = "0755",
)

oci_image(
    name = "cli_image_amd64",
    base = "//src:osmo_docker_client_image_amd64",
    tars = [
        ":osmo_cli_pkg_amd64",
        ":cli_symlinks_tar",
    ],
    visibility = ["//visibility:public"],
)

# Local image testing only
oci_load(
    name = "cli_image_amd64_load",
    image = ":cli_image_amd64",
    repo_tags = ["cli_image_amd64:latest"],
)

oci_push(
    name = "cli_push_x86_64",
    image = ":cli_image_amd64",
    repository = BASE_IMAGE_URL + "client",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "manual",
    ],
)

################
#    arm64    #
################

osmo_py_binary(
    name = "cli_builder_arm64",
    main = "cli_builder_arm64.py",
    srcs = ["cli_builder_arm64.py"],
    deps = [
        ":cli_lib",
        requirement("pyinstaller"),
        requirement("shtab"),
    ],
    tags = ["arm64"],
)

run_binary(
    name = "cli_onedir_arm64",
    args = [
        "--output_dir $(@D)",
        "--main $(location :cli.py)",
        "--add-data $(location //src/lib/rsync:rsync_bin):src/lib/rsync/",
        "--add-data $(location //src/lib/utils:version.yaml):src/lib/utils/",
        "--additional-hooks $(locations //src/lib/data/storage:extra_hooks)",
    ],
    out_dirs = ["osmo_cli_onedir_arm64"],
    tool = ":cli_builder_arm64",
    srcs = [
        "cli.py",
        ":cli_lib",
        "//src/lib/utils:version.yaml",
        "//src/lib/data/storage:extra_hooks",
        "//src/lib/rsync:rsync_bin",
    ],
    tags = ["arm64"],
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "osmo_cli_pkg_arm64",
    extension = "tgz",
    remap_paths = {
        "/osmo_cli_onedir_arm64": ".",
    },
    srcs = [":cli_onedir_arm64"],
    symlinks = {
        "osmo/osmo": "osmo-cli/osmo-cli",
    },
    package_dir = "/osmo/osmo_cli_onedir",
    visibility = ["//visibility:public"],
    mode = "0755",
    tags = ["arm64"],
)

oci_image(
    name = "cli_image_arm64",
    base = "//src:osmo_docker_client_image_arm64",
    tars = [
        ":osmo_cli_pkg_arm64",
        ":cli_symlinks_tar",
    ],
    visibility = ["//visibility:public"],
    tags = ["arm64"],
)

# Local image testing only
oci_load(
    name = "cli_image_arm64_load",
    image = ":cli_image_arm64",
    repo_tags = ["cli_image_arm64:latest"],
)

oci_push(
    name = "cli_push_arm64",
    image = ":cli_image_arm64",
    repository = BASE_IMAGE_URL + "client",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = [
        "arm64",
        "manual",
    ],
)

################
#    Common    #
################

pkg_tar(
    name = "cli_symlinks_tar",
    symlinks = {
        "/usr/bin/osmo": "/osmo/osmo_cli_onedir/osmo/osmo",
    },
    visibility = ["//visibility:public"],
)
