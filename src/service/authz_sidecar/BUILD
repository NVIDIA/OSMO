# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

# gazelle:prefix go.corp.nvidia.com/osmo
gazelle(name = "gazelle")

go_library(
    name = "authz_sidecar",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/service/authz_sidecar",
    visibility = ["//visibility:private"],
    deps = [
        "//src/service/authz_sidecar/server:server",
        "//src/utils/postgres:postgres",
        "//src/utils/roles",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//health:go_default_library",
        "@org_golang_google_grpc//health/grpc_health_v1:go_default_library",
        "@org_golang_google_grpc//keepalive:go_default_library",
    ],
)

################
#    x86_64    #
################

go_binary(
    name = "authz_sidecar_bin_x86_64",
    basename = "authz_sidecar",
    embed = [":authz_sidecar"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "authz_sidecar_pkg_x86_64",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":authz_sidecar_bin_x86_64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)

oci_image(
    name = "authz_sidecar_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":authz_sidecar_pkg_x86_64"],
    entrypoint = ["/osmo/authz_sidecar"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "authz_sidecar_image_load_x86_64",
    image = ":authz_sidecar_image_x86_64",
    repo_tags = ["osmo.local/authz-sidecar:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "authz_sidecar_push_x86_64",
    image = ":authz_sidecar_image_x86_64",
    repository = BASE_IMAGE_URL + "authz-sidecar",
    remote_tags = [IMAGE_TAG + "-amd64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

###############
#    arm64    #
###############

go_binary(
    name = "authz_sidecar_bin_arm64",
    basename = "authz_sidecar",
    embed = [":authz_sidecar"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
)

pkg_tar(
    name = "authz_sidecar_pkg_arm64",
    extension = "tgz",
    package_dir = "/osmo",
    srcs = [":authz_sidecar_bin_arm64"],
    mode = "0755",
    visibility = ["//visibility:public"],
)

oci_image(
    name = "authz_sidecar_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":authz_sidecar_pkg_arm64"],
    entrypoint = ["/osmo/authz_sidecar"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "authz_sidecar_image_load_arm64",
    image = ":authz_sidecar_image_arm64",
    repo_tags = ["osmo.local/authz-sidecar:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "authz_sidecar_push_arm64",
    image = ":authz_sidecar_image_arm64",
    repository = BASE_IMAGE_URL + "authz-sidecar",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

# Integration test - requires running authz_sidecar service
#
# To run this test:
#   1. Start PostgreSQL:
#      docker run --rm -d --name postgres -p 5432:5432 \
#        -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1
#
#   2. Start authz_sidecar:
#      bazel run //src/service/authz_sidecar:authz_sidecar_bin_x86_64 -- \
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
        "@com_github_envoyproxy_go_control_plane_envoy//service/auth/v3:auth",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//credentials/insecure:go_default_library",
        "@org_golang_google_grpc//health/grpc_health_v1:go_default_library",
    ],
    visibility = ["//visibility:public"],
    tags = ["service", "manual"],  # Requires service
    local = True,  # Run locally without sandboxing
)

# Performance benchmark test for Go authz_sidecar
#
# To run this test:
#   1. Start PostgreSQL:
#      docker run --rm -d --name postgres -p 5432:5432 \
#        -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1
#
#   2. Start Go authz_sidecar:
#      bazel run //src/service/authz_sidecar:authz_sidecar_bin_x86_64 -- \
#        --postgres-password=osmo --postgres-db=osmo_db --postgres-host=localhost
#
#   3. Run the benchmark:
#      bazel test //src/service/authz_sidecar:performance_comparison --test_output=streamed
#
go_test(
    name = "performance_comparison",
    srcs = ["performance_comparison_test.go"],
    deps = [
        "@com_github_envoyproxy_go_control_plane_envoy//service/auth/v3:auth",
        "@org_golang_google_grpc//:go_default_library",
        "@org_golang_google_grpc//credentials/insecure:go_default_library",
    ],
    visibility = ["//visibility:public"],
    tags = ["service", "manual", "benchmark"],
    local = True,
)

