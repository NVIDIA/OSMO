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
    name = "roles",
    srcs = [
        "action_registry.go",
        "role_cache.go",
        "roles.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/utils/roles",
    visibility = ["//visibility:public"],
    deps = [
        "//src/utils/postgres",
        "@com_github_hashicorp_golang_lru_v2//:go_default_library",
    ],
)

go_test(
    name = "roles_test",
    srcs = [
        "action_registry_test.go",
        "role_cache_test.go",
        "roles_test.go",
    ],
    embed = [":roles"],
    deps = [],
)
