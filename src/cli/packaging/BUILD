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

load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

pkg_tar(
    name = "osmo_cli_pkg_amd64",
    extension = "tgz",
    remap_paths = {
        "/osmo_cli_onedir_amd64": ".",
    },
    srcs = [
        "//src/cli:cli_onedir_amd64",
    ],
    symlinks = {
        "osmo/osmo": "osmo-cli/osmo-cli",
    },
    mode = "0755",
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

pkg_tar(
    name = "osmo_cli_pkg_arm64",
    extension = "tgz",
    remap_paths = {
        "/osmo_cli_onedir_arm64": ".",
    },
    srcs = [
        "//src/cli:cli_onedir_arm64",
    ],
    symlinks = {
        "osmo/osmo": "osmo-cli/osmo-cli",
    },
    mode = "0755",
    tags = ["arm64"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
