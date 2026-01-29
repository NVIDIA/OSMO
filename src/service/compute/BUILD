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
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load", "oci_push")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

################################################################
#                      Utils Library                           #
################################################################

go_library(
    name = "utils",
    srcs = [
        "utils/helpers.go",
        "utils/args.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/service/compute/utils",
    visibility = ["//src/service/compute:__subpackages__"],
    deps = [
        "//src/proto/compute_connector:compute_connector_go_proto",
        "//src/utils/postgres",
        "//src/utils/redis",
        "@com_github_jackc_pgx_v5//pgxpool",
        "@org_golang_google_grpc//codes",
        "@org_golang_google_grpc//metadata",
        "@org_golang_google_grpc//status",
    ],
)

go_test(
    name = "utils_test",
    srcs = ["utils/helpers_test.go"],
    embed = [":utils"],
    deps = [
        "@org_golang_google_grpc//metadata",
    ],
)

################################################################
#                   Listener Service Library                   #
################################################################

go_library(
    name = "listener_service",
    srcs = ["listener_service/listener_service.go"],
    importpath = "go.corp.nvidia.com/osmo/service/compute/listener_service",
    visibility = ["//src/service/compute:__subpackages__"],
    deps = [
        ":utils",
        "//src/proto/compute_connector:compute_connector_go_proto",
        "//src/utils/progress_check:progress_writer",
        "@com_github_jackc_pgx_v5//pgxpool",
        "@com_github_redis_go_redis_v9//:go-redis",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//codes",
        "@org_golang_google_grpc//status",
        "@org_golang_google_protobuf//encoding/protojson",
    ],
)

go_test(
    name = "listener_service_test",
    srcs = ["listener_service/listener_service_test.go"],
    embed = [":listener_service"],
    deps = [
        "//src/proto/compute_connector:compute_connector_go_proto",
        "@com_github_redis_go_redis_v9//:go-redis",
        "@org_golang_google_grpc//metadata",
    ],
)

################################################################
#                    Compute Service Main                     #
################################################################

go_library(
    name = "compute_service_lib",
    srcs = ["main.go"],
    importpath = "go.corp.nvidia.com/osmo/service/compute",
    visibility = ["//visibility:private"],
    deps = [
        ":listener_service",
        ":utils",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//health",
        "@org_golang_google_grpc//health/grpc_health_v1",
        "@org_golang_google_grpc//keepalive",
    ],
)

################
#    x86_64    #
################

go_binary(
    name = "compute_service_x86_64",
    basename = "compute_service",
    embed = [":compute_service_lib"],
    goarch = "amd64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

pkg_tar(
    name = "compute_service_x86_64_pkg",
    srcs = [":compute_service_x86_64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_image(
    name = "compute_service_image_x86_64",
    base = "//src:osmo_docker_distroless_image_amd64",
    tars = [":compute_service_x86_64_pkg"],
    entrypoint = ["/usr/local/bin/compute_service"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_load(
    name = "compute_service_image_load_x86_64",
    image = ":compute_service_image_x86_64",
    repo_tags = ["osmo.local/compute-service:latest-x86_64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:x86_64",
    ],
)

oci_push(
    name = "compute_service_push_x86_64",
    image = ":compute_service_image_x86_64",
    repository = BASE_IMAGE_URL + "compute-service",
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
    name = "compute_service_arm64",
    basename = "compute_service",
    embed = [":compute_service_lib"],
    goarch = "arm64",
    goos = "linux",
    pure = "on",
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

pkg_tar(
    name = "compute_service_arm64_pkg",
    srcs = [":compute_service_arm64"],
    mode = "0755",
    package_dir = "/usr/local/bin",
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_image(
    name = "compute_service_image_arm64",
    base = "//src:osmo_docker_distroless_image_arm64",
    tars = [":compute_service_arm64_pkg"],
    entrypoint = ["/usr/local/bin/compute_service"],
    visibility = ["//visibility:public"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_load(
    name = "compute_service_image_load_arm64",
    image = ":compute_service_image_arm64",
    repo_tags = ["osmo.local/compute-service:latest-arm64"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)

oci_push(
    name = "compute_service_push_arm64",
    image = ":compute_service_image_arm64",
    repository = BASE_IMAGE_URL + "compute-service",
    remote_tags = [IMAGE_TAG + "-arm64"] if IMAGE_TAG else None,
    visibility = ["//visibility:public"],
    tags = ["manual"],
    target_compatible_with = [
        "@platforms//cpu:arm64",
    ],
)
