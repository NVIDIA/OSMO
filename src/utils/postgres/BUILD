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

load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")

go_library(
    name = "postgres",
    srcs = [
        "postgres_client.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/utils/postgres",
    visibility = ["//visibility:public"],
    deps = [
        "//src/utils",
        "@com_github_jackc_pgx_v5//pgxpool:go_default_library",
    ],
)

go_test(
    name = "postgres_test",
<<<<<<< HEAD
    srcs = [
        "postgres_client_test.go",
    ],
=======
    srcs = ["postgres_client_test.go"],
>>>>>>> origin/main
    embed = [":postgres"],
    deps = [
        "@com_github_jackc_pgx_v5//pgxpool:go_default_library",
    ],
)
<<<<<<< HEAD

# Integration test - requires running PostgreSQL instance
#
# To run this test:
#   1. Start PostgreSQL:
#      docker run --rm -d --name postgres -p 5432:5432 \
#        -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1
#
#   2. Run the test:
#      bazel test //src/utils/postgres:postgres_integration_test --test_output=streamed
#
# Custom PostgreSQL configuration:
#   bazel test //src/utils/postgres:postgres_integration_test \
#     --test_output=streamed \
#     --test_arg=-postgres-host=localhost \
#     --test_arg=-postgres-port=5432 \
#     --test_arg=-postgres-db=osmo_db \
#     --test_arg=-postgres-user=postgres \
#     --test_arg=-postgres-password=osmo
#
go_test(
    name = "postgres_integration_test",
    srcs = [
        "postgres_integration_test.go",
    ],
    embed = [":postgres"],
    deps = [],
    tags = ["manual", "service"],  # Requires running PostgreSQL instance
    local = True,  # Run locally without sandboxing to access external database
)
=======
>>>>>>> origin/main
