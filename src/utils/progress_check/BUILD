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

osmo_py_library(
    name = "progress_check",
    srcs = [
        "progress.py",
        "progress_check.py",
    ],
    deps = [
        requirement("pydantic"),
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "builder",
    main = "builder.py",
    srcs = ["builder.py"],
    deps = [
        requirement("pyinstaller"),
        ":progress_check",
    ],
)

run_binary(
    name = "progress_check_onedir",
    args = [
        "--name osmo-progress-check",
        "--main $(location :progress_check.py)",
        "--output_dir $(@D)",
    ],
    out_dirs = ["osmo_progress_check_onedir"],
    tool = ":builder",
    srcs = [
        "progress_check.py",
        ":progress_check",
    ],
)

pkg_tar(
    name = "progress_check_onedir_pkg",
    extension = "tgz",
    remap_paths = {
        "/osmo_progress_check_onedir": ".",
    },
    srcs = [":progress_check_onedir"],
    symlinks = {
        "/usr/bin/progress_check": "/osmo/osmo-progress-check/osmo-progress-check",
    },
    mode = "0755",
    visibility = ["//visibility:public"],
)
