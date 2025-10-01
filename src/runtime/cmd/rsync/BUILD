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

go_library(
    name = "rsync",
    srcs = ["rsync.go"],
    importpath = "go.corp.nvidia.com/osmo/cmd/user/rsync",
    deps = [
        "//src/runtime/pkg/common:common",
        "@com_github_conduitio_bwlimit//:go_default_library",
        "@com_github_gokrazy_rsync//rsyncd:go_default_library",
    ],
)

go_binary(
    name = "rsync_x86_64",
    basename = "rsync",
    embed = [":rsync"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

go_binary(
    name = "rsync_arm64",
    basename = "rsync",
    embed = [":rsync"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "rsync_x86_64_pkg",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":rsync_x86_64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "rsync_arm64_pkg",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":rsync_arm64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)
