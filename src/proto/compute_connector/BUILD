# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

load("@rules_proto//proto:defs.bzl", "proto_library")
load("@io_bazel_rules_go//proto:def.bzl", "go_proto_library")

proto_library(
    name = "compute_connector_proto",
    srcs = [
        "messages.proto",
        "services.proto",
    ],
)

# To generate go code for IDE support, run the following commands:
#
# bazel build //src/proto/compute_connector:compute_connector_go_proto
# cp $(bazel info bazel-bin)/src/proto/compute_connector/compute_connector_go_proto_/go.corp.nvidia.com/osmo/proto/compute_connector/*.go src/proto/compute_connector/
#
go_proto_library(
    name = "compute_connector_go_proto",
    compilers = ["@io_bazel_rules_go//proto:go_grpc"],
    importpath = "go.corp.nvidia.com/osmo/proto/compute_connector",
    proto = ":compute_connector_proto",
)
