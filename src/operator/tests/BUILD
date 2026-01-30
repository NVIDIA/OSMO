# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@io_bazel_rules_go//go:def.bzl", "go_test")

exports_files([
    "test_calculate_pod_status_cases.json",
    "test_node_usage_cases.json",
    "test_node_helpers_cases.json",
])

py_test(
    name = "test_listener",
    srcs = [
        "test_listener.py"
    ],
    tags = ["manual"],
    deps = [
        requirement("kubernetes"),
        "//src/utils/job",
        "//src/operator:backend_listener_lib"
    ]
)

py_test(
    name = "test_pod_status_calculator",
    srcs = [
        "test_pod_status_calculator.py"
    ],
    data = [
        "test_calculate_pod_status_cases.json",
    ],
    deps = [
        requirement("pydantic"),
        requirement("kubernetes"),
        "//src/operator:backend_listener_lib",
        "//src/utils/job",
    ],
)

go_test(
    name = "node_helpers_test",
    srcs = ["node_helpers_test.go"],
    data = ["test_node_helpers_cases.json"],
    deps = [
        "//src/operator/utils",
        "//src/proto/operator:operator_go_proto",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/api/resource:resource",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
    ],
)

go_test(
    name = "node_usage_test",
    srcs = ["node_usage_test.go"],
    data = ["test_node_usage_cases.json"],
    deps = [
        "//src/operator/utils",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/api/resource:resource",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
        "@io_k8s_apimachinery//pkg/types:types",
    ],
)
