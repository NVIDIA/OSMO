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
    name = "redis",
    srcs = [
        "redis_client.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/utils/redis",
    visibility = ["//visibility:public"],
    deps = [
        "//src/utils",
        "@com_github_redis_go_redis_v9//:go_default_library",
    ],
)

go_test(
    name = "redis_test",
    srcs = ["redis_client_test.go"],
    embed = [":redis"],
    deps = [
        "//src/utils",
    ],
)
