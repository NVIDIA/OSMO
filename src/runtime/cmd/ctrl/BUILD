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

load("@io_bazel_rules_go//go:def.bzl", "go_binary", "go_library", "go_test")
load("@bazel_gazelle//:def.bzl", "gazelle")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

# gazelle:prefix osmo_exec
gazelle(name = "gazelle")

go_library(
    name = "ctrl",
    srcs = [
        "ctrl.go",
        "forward.go",
        "forward_grpc.go",
        "forward_ws.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/runtime/cmd/ctrl",
    visibility = ["//visibility:private"],
    deps = [
        "//src/pkg/router",
        "//src/proto/router:router_go_proto",
        "//src/runtime/pkg/args:ctrl_args",
        "//src/runtime/pkg/common:common",
        "//src/runtime/pkg/data:data",
        "//src/runtime/pkg/messages:messages",
        "//src/runtime/pkg/metrics",
        "//src/runtime/pkg/osmo_errors:osmo_errors",
        "//src/runtime/pkg/rsync:rsync",
        "@com_github_gorilla_websocket//:go_default_library",
        "@in_gopkg_yaml_v3//:yaml_v3",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//metadata",
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


# To run the tests with race detection:
#
# bazel test \
#   --@io_bazel_rules_go//go/config:race \
#  //src/runtime/cmd/ctrl:forward_test
go_test(
    name = "forward_test",
    srcs = ["forward_test.go"],
    embed = [":ctrl"],
    deps = [
        "//src/pkg/router",
        "//src/proto/router:router_go_proto",
        "//src/runtime/pkg/args:ctrl_args",
        "@com_github_gorilla_websocket//:go_default_library",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//credentials/insecure",
        "@org_golang_google_grpc//test/bufconn",
    ],
    size = "medium",
)

# Benchmark comparing WS (Python Router) vs gRPC (Go Router) forwarders
#
# REQUIRES EXTERNAL ROUTERS - start them in separate terminals first:
#
# Terminal 1 - Start Go Router (with 16MB max message size):
#
#   bazel run //src/service/router_go -- --port=50051 --tls-enabled=false --max-message-size=16777216
#
# Terminal 2 - Start Python Router:
#
#   bazel run //src/service/router -- --host http://127.0.0.1:8001 --method=dev
#
# Terminal 3 - Run benchmarks:
#
#   GO_ROUTER_ADDR=127.0.0.1:50051 \
#   PYTHON_ROUTER_URL=http://127.0.0.1:8001 \
#   bazel test //src/runtime/cmd/ctrl:forward_benchmark \
#     --test_output=streamed \
#     --test_env=GO_ROUTER_ADDR \
#     --test_env=PYTHON_ROUTER_URL
#
go_test(
    name = "forward_benchmark",
    srcs = ["forward_benchmark_test.go"],
    embed = [":ctrl"],
    deps = [
        "//src/pkg/router",
        "//src/proto/router:router_go_proto",
        "//src/runtime/pkg/args:ctrl_args",
        "@com_github_gorilla_websocket//:go_default_library",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//credentials/insecure",
    ],
    size = "large",
    timeout = "long",
    tags = [
        "benchmark",
        "manual",
        "requires-network",
    ],
)
