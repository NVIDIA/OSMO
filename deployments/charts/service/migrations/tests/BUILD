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

load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_users_backfill_migration",
    srcs = ["test_users_backfill_migration.py"],
    data = ["//deployments/charts/service/migrations:migration_files"],
    deps = [
        "//src/tests/common",
        "//src/utils/connectors",
        "@rules_python//python/runfiles",
        requirement("psycopg2-binary"),
    ],
    size = "medium",
    tags = ["requires-network"],
)
