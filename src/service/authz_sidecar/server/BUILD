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

load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")

go_library(
    name = "server",
    srcs = [
        "authz_server.go",
        "role_cache.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/service/authz_sidecar/server",
    visibility = ["//src/service/authz_sidecar:__subpackages__"],
    deps = [
        "//src/service/utils_go:utils_go",
        "@com_github_envoyproxy_go_control_plane//envoy/config/core/v3:go_default_library",
        "@com_github_envoyproxy_go_control_plane//envoy/service/auth/v3:go_default_library",
        "@com_github_envoyproxy_go_control_plane//envoy/type/v3:go_default_library",
        "@org_golang_google_genproto_googleapis_rpc//status:go_default_library",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//codes:go_default_library",
    ],
)

go_test(
    name = "server_test",
    srcs = [
        "authz_server_test.go",
        "role_cache_test.go",
        "integration_test.go",
    ],
    embed = [":server"],
    deps = [
        "//src/service/utils_go:utils_go",
        "@com_github_envoyproxy_go_control_plane//envoy/config/core/v3:go_default_library",
        "@com_github_envoyproxy_go_control_plane//envoy/service/auth/v3:go_default_library",
        "@org_golang_google_grpc//codes:go_default_library",
    ],
)

