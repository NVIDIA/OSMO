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
        "//src/service/utils_go/postgres:postgres",
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

# Integration test - requires running authz_sidecar service
#
# To run this test:
#   1. Start PostgreSQL:
#      docker run --rm -d --name postgres -p 5432:5432 \
#        -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1
#
#   2. Start authz_sidecar:
#      bazel run //src/service/authz_sidecar:authz_sidecar_bin -- \
#        --postgres-password=osmo --postgres-db=osmo_db --postgres-host=localhost
#
#   3. Run the test:
#      bazel test //src/service/authz_sidecar:authz_sidecar_integration_test --test_output=streamed
#
# Custom service address:
#   bazel test //src/service/authz_sidecar:authz_sidecar_integration_test \
#     --test_output=streamed \
#     --test_arg=-authz-addr=localhost:50052
#
go_test(
    name = "authz_sidecar_integration_test",
    srcs = ["integration_test.go"],
    deps = [
        "@com_github_envoyproxy_go_control_plane//envoy/service/auth/v3:auth",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//credentials/insecure:go_default_library",
        "@org_golang_google_grpc//health/grpc_health_v1:go_default_library",
    ],
    visibility = ["//visibility:public"],
    tags = ["external", "manual"],  # Requires external service
    local = True,  # Run locally without sandboxing
)

# Performance comparison test - Python middleware vs Go authz_sidecar
#
# To run this test:
#   1. Start PostgreSQL:
#      docker run --rm -d --name postgres -p 5432:5432 \
#        -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1
#
#   2. Start Python test service:
#      cd external/src/service/authz_sidecar/test_service_python
#      pip install -r requirements.txt
#      python service.py --postgres-password=osmo
#
#   3. Start Go authz_sidecar:
#      cd external && bazel run //src/service/authz_sidecar:authz_sidecar_bin -- \
#        --postgres-password=osmo --postgres-db=osmo_db --postgres-host=localhost
#
#   4. Run the benchmark:
#      bazel test //src/service/authz_sidecar:performance_comparison --test_output=streamed
#
go_test(
    name = "performance_comparison",
    srcs = ["performance_comparison_test.go"],
    deps = [
        "@com_github_envoyproxy_go_control_plane//envoy/service/auth/v3:auth",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//credentials/insecure:go_default_library",
    ],
    visibility = ["//visibility:public"],
    tags = ["external", "manual", "benchmark"],
    local = True,
)

