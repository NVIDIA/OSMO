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
    name = "operator",
    srcs = [
        "api.go",
        "http.go",
        "server.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/service/operator",
    visibility = ["//visibility:public"],
    deps = [
        "//src/apis/taskgroup/v1alpha1",
        "//src/proto/operator:operator_go_proto",
        "@io_k8s_apimachinery//pkg/api/errors:go_default_library",
        "@io_k8s_apimachinery//pkg/runtime:go_default_library",
        "@io_k8s_apimachinery//pkg/types:go_default_library",
        "@io_k8s_client_go//rest:go_default_library",
        "@io_k8s_client_go//tools/clientcmd:go_default_library",
        "@io_k8s_sigs_controller_runtime//pkg/client:client",
        "@io_k8s_sigs_yaml//:go_default_library",
    ],
)

go_library(
    name = "utils",
    srcs = [
        "utils/helpers.go",
        "utils/operator_args.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/service/operator/utils",
    visibility = ["//src/service/operator:__subpackages__"],
)

go_test(
    name = "operator_test",
    srcs = ["server_test.go"],
    embed = [":operator"],
    deps = [
        "//src/apis/taskgroup/v1alpha1",
        "@io_k8s_apimachinery//pkg/runtime:go_default_library",
        "@io_k8s_sigs_controller_runtime//pkg/client:client",
        "@io_k8s_sigs_controller_runtime//pkg/client/fake:fake",
    ],
)

go_test(
    name = "utils_test",
    srcs = ["utils/helpers_test.go"],
    embed = [":utils"],
)
