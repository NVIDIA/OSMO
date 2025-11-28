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

load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")

go_library(
    name = "router",
    srcs = glob(["*.go"]),
    importpath = "go.corp.nvidia.com/osmo/pkg/router",
    deps = [
        "//src/proto/router:router_go_proto",
        "@org_golang_google_grpc//:grpc",
    ],
)

go_test(
    name = "tunnel_test",
    srcs = ["tunnel_test.go"],
    embed = [":router"],
    deps = [
        "//src/proto/router:router_go_proto",
    ],
)
