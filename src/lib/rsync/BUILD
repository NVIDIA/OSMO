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

package(default_visibility = ["//visibility:public"])

load("//bzl:py.bzl", "osmo_py_library")
load("@io_bazel_rules_go//go:def.bzl", "go_cross_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")

# TODO: build platform-specific py_wheel to ensure rsync compatibility
go_cross_binary(
    name = "rsync_bin",
    target = "@com_github_gokrazy_rsync//cmd/gokr-rsync:gokr-rsync",
    platform = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@io_bazel_rules_go//go/toolchain:darwin_arm64",
        "@bazel_tools//src/conditions:linux_aarch64": "@io_bazel_rules_go//go/toolchain:linux_arm64",
        "@bazel_tools//src/conditions:linux_x86_64": "@io_bazel_rules_go//go/toolchain:linux_amd64",
    }),
)

osmo_py_library(
    name = "rsync",
    srcs = glob(["*.py"]),
    deps = [
        requirement("watchdog"),
        "//src/lib/utils:client",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:paths",
        "//src/lib/utils:port_forward",
        "//src/lib/utils:validation",
        "@rules_python//python/runfiles",
    ],
    data = [
        ":rsync_bin",
    ],
)
