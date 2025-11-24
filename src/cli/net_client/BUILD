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

load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library")

go_library(
    name = "net_client_lib",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/src/cli/net_client",
    visibility = ["//visibility:private"],
    deps = [
        "//proto:router_go_proto",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//credentials",
        "@org_golang_google_grpc//credentials/insecure",
        "@org_golang_google_grpc//keepalive",
    ],
)

go_binary(
    name = "osmo-net-client",
    embed = [":net_client_lib"],
    visibility = ["//visibility:public"],
)

# Multi-platform builds
go_binary(
    name = "osmo-net-client-linux-amd64",
    embed = [":net_client_lib"],
    goos = "linux",
    goarch = "amd64",
    visibility = ["//visibility:public"],
)

go_binary(
    name = "osmo-net-client-linux-arm64",
    embed = [":net_client_lib"],
    goos = "linux",
    goarch = "arm64",
    visibility = ["//visibility:public"],
)

go_binary(
    name = "osmo-net-client-darwin-amd64",
    embed = [":net_client_lib"],
    goos = "darwin",
    goarch = "amd64",
    visibility = ["//visibility:public"],
)

go_binary(
    name = "osmo-net-client-darwin-arm64",
    embed = [":net_client_lib"],
    goos = "darwin",
    goarch = "arm64",
    visibility = ["//visibility:public"],
)
