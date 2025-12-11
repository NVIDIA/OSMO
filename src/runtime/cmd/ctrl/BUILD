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

load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library")
load("@bazel_gazelle//:def.bzl", "gazelle")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

# gazelle:prefix osmo_exec
gazelle(name = "gazelle")

go_library(
    name = "ctrl",
    srcs = ["ctrl.go"],
    importpath = "go.corp.nvidia.com/osmo/runtime/cmd/user",
    visibility = ["//visibility:private"],
    deps = [
        "//src/runtime/pkg/args:ctrl_args",
        "//src/runtime/pkg/data:data",
        "//src/runtime/pkg/common:common",
        "//src/runtime/pkg/messages:messages",
        "//src/runtime/pkg/metrics",
        "//src/runtime/pkg/osmo_errors:osmo_errors",
        "//src/runtime/pkg/rsync:rsync",
        "@com_github_gorilla_websocket//:go_default_library",
        "@in_gopkg_yaml_v3//:yaml_v3",
    ],
)

go_binary(
    name = "osmo_ctrl_x86_64",
    basename = "osmo_ctrl",
    embed = [":ctrl"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

go_binary(
    name = "osmo_ctrl_arm64",
    basename = "osmo_ctrl",
    embed = [":ctrl"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "osmo_ctrl_x86_64_pkg",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":osmo_ctrl_x86_64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "osmo_ctrl_arm64_pkg",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":osmo_ctrl_arm64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)
