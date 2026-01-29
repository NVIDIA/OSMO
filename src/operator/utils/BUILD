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

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")
load("@io_bazel_rules_go//go:def.bzl", "go_library", "go_test")


osmo_py_library(
    name = "login",
    srcs = [
        "login.py",
        "objects.py",
        "service_connector.py"
    ],
    deps = [
        requirement("requests"),
        requirement("urllib3"),
        "//src/lib/utils:logging",
        "//src/lib/utils:login",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:version",
        "//src/operator/utils/node_validation_test:test_base",
        "//src/utils:static_config",
        "//src/utils/metrics:metrics",
    ],
    visibility = ["//visibility:public"],
)

go_library(
    name = "utils",
    srcs = [
        "base_listener.go",
        "container_status.go",
        "helpers.go",
        "k8s_helpers.go",
        "listener_args.go",
        "task_status.go",
        "unack_messages.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/operator/utils",
    visibility = ["//visibility:public"],
    deps = [
        "//src/proto/compute_connector:compute_connector_go_proto",
        "//src/utils/progress_check:progress_writer",
        "@com_github_google_uuid//:uuid",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
        "@io_k8s_client_go//kubernetes",
        "@io_k8s_client_go//rest",
        "@io_k8s_client_go//tools/clientcmd",
        "@org_golang_google_grpc//:grpc",
        "@org_golang_google_grpc//credentials/insecure",
    ],
)

# Run this  manually
go_test(
    name = "calculate_status_test",
    srcs = ["calculate_status_test.go"],
    data = ["//src/operator/tests:test_calculate_pod_status_cases.json"],
    embed = [":utils"],
    tags = ["manual"],
    deps = [
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
    ],
)

go_test(
    name = "unack_messages_test",
    srcs = ["unack_messages_test.go"],
    embed = [":utils"],
    deps = [
        "//src/proto/compute_connector:compute_connector_go_proto",
        "@io_k8s_api//core/v1:core",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:meta",
    ],
)
