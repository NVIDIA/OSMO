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

load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")

go_library(
    name = "auth",
    srcs = [
        "interceptor.go",
        "metadata.go",
        "roles.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/internal/auth",
    visibility = ["//visibility:public"],
    deps = [
        "@com_github_jackc_pgx_v5//:pgx",
        "@com_github_jackc_pgx_v5//pgxpool",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//codes",
        "@org_golang_google_grpc//metadata",
        "@org_golang_google_grpc//status",
    ],
)

go_test(
    name = "auth_test",
    srcs = ["auth_test.go"],
    embed = [":auth"],
    deps = [
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//codes",
        "@org_golang_google_grpc//metadata",
        "@org_golang_google_grpc//status",
    ],
)

go_test(
    name = "roles_test",
    srcs = ["roles_test.go"],
    embed = [":auth"],
    deps = [
        "@com_github_pashagolub_pgxmock_v4//:pgxmock",
    ],
)
