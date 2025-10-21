# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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

package(default_visibility = ["//visibility:public"])

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")

osmo_py_binary(
    name = "cli_packager",
    main = "cli_packager.py",
    srcs = ["cli_packager.py"],
    deps = [
        "//src/lib/utils:version",
    ]
)

run_binary(
    name = "macos_client_unsigned_pkg_arm64",
    args = [
        "--input_tar_path $(location //src/cli/packaging:osmo_cli_pkg_arm64)",
        "--entitlement_path $(location entitlements.plist)",
        "--preinstall_script_path $(location preinstall)",
        "--postinstall_script_path $(location postinstall)",
        "--output_path $(location macos_client_unsigned_pkg_arm64.pkg)",
    ],
    outs = [
        "macos_client_unsigned_pkg_arm64.pkg",
    ],
    tool = ":cli_packager",
    srcs = [
        "//src/cli/packaging:osmo_cli_pkg_arm64",
        "entitlements.plist",
        "preinstall",
        "postinstall",
    ],
    tags = [
        "arm64",
        "manual",
    ],
    target_compatible_with = [
        "@platforms//cpu:arm64",
        "@platforms//os:macos",
    ],
)
