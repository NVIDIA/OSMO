#####################################################################################
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
#####################################################################################

load("//bzl:py.bzl", "osmo_py_library")
load("@io_bazel_rules_go//go:def.bzl", "go_library")
load("@osmo_python_deps//:requirements.bzl", osmo_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", test_requirement = "requirement")

osmo_py_library(
    name = "database",
    srcs = glob(["*.py"]),
    deps = [
        osmo_requirement("psycopg2-binary"),
        test_requirement("testcontainers"),
        "//src/tests/common/core",
        "//src/utils/connectors:connectors",
    ],
    visibility = ["//visibility:public"],
)

go_library(
    name = "database_go",
    srcs = glob(["*.go"]),
    embedsrcs = glob(["testdata/**"]),
    importpath = "go.corp.nvidia.com/osmo/tests/common/database",
    visibility = ["//visibility:public"],
    deps = [
        "//src/utils/postgres:postgres",
        "@com_github_jackc_pgx_v5//pgxpool:go_default_library",
        "@com_github_testcontainers_testcontainers_go//:go_default_library",
        "@com_github_testcontainers_testcontainers_go_modules_postgres//:go_default_library",
        "@com_github_testcontainers_testcontainers_go//wait:go_default_library",
    ],
)
