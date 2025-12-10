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
load("@io_bazel_rules_docker//go:image.bzl", "go_image")
load("@io_bazel_rules_docker//container:container.bzl", "container_push")

# gazelle:prefix go.corp.nvidia.com/osmo
gazelle(name = "gazelle")

go_library(
    name = "authz_sidecar",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/service/authz_sidecar",
    visibility = ["//visibility:private"],
    deps = [
        "//src/service/authz_sidecar/server:server",
        "//src/service/utils_go:utils_go",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//health:go_default_library",
        "@org_golang_google_grpc//health/grpc_health_v1:go_default_library",
        "@org_golang_google_grpc//keepalive:go_default_library",
    ],
)

go_binary(
    name = "authz_sidecar_bin",
    embed = [":authz_sidecar"],
    visibility = ["//visibility:public"],
)

go_image(
    name = "authz_sidecar_image",
    embed = [":authz_sidecar"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "authz_sidecar_pkg",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":authz_sidecar_bin"],
    mode = "0755",
    visibility = ["//visibility:public"],
)

