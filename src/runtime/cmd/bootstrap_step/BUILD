# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library", "go_test")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

go_library(
    name = "bootstrap_step",
    srcs = ["main.go", "process_linux.go", "lease.go"],
    importpath = "go.corp.nvidia.com/osmo/runtime/cmd/bootstrap_step",
    target_compatible_with = ["@platforms//os:linux"],
    visibility = ["//visibility:private"],
)

go_test(
    name = "bootstrap_step_test",
    srcs = ["main_test.go"],
    embed = [":bootstrap_step"],
    target_compatible_with = ["@platforms//os:linux"],
)

go_binary(
    name = "bootstrap_step_x86_64",
    basename = "bootstrap-step",
    embed = [":bootstrap_step"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
)

go_binary(
    name = "bootstrap_step_arm64",
    basename = "bootstrap-step",
    embed = [":bootstrap_step"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
)

pkg_tar(
    name = "bootstrap_step_x86_64_pkg",
    srcs = [":bootstrap_step_x86_64"],
    package_dir = "/osmo",
    mode = "0755",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "bootstrap_step_arm64_pkg",
    srcs = [":bootstrap_step_arm64"],
    package_dir = "/osmo",
    mode = "0755",
    visibility = ["//visibility:public"],
)
