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
    name = "taskgroup",
    srcs = [
        "controller.go",
        "generic.go",
        "interfaces.go",
        "kai.go",
        "log_collector.go",
        "runtime_status.go",
        "runtime_config.go",
    ],
    importpath = "go.corp.nvidia.com/osmo/controller/taskgroup",
    visibility = ["//visibility:public"],
    deps = [
        "//src/apis/taskgroup/v1alpha1",
        "@io_k8s_api//core/v1:go_default_library",
        "@io_k8s_api//scheduling/v1:go_default_library",
        "@io_k8s_apimachinery//pkg/api/errors:go_default_library",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:go_default_library",
        "@io_k8s_apimachinery//pkg/apis/meta/v1/unstructured:go_default_library",
        "@io_k8s_apimachinery//pkg/runtime:go_default_library",
        "@io_k8s_apimachinery//pkg/util/sets:go_default_library",
        "@io_k8s_client_go//kubernetes:kubernetes",
        "@io_k8s_sigs_controller_runtime//:controller-runtime",
        "@io_k8s_sigs_controller_runtime//pkg/client:client",
    ],
)

go_test(
    name = "taskgroup_test",
    srcs = [
        "controller_test.go",
        "kai_test.go",
    ],
    embed = [":taskgroup"],
    deps = [
        "//src/apis/taskgroup/v1alpha1",
        "@io_k8s_api//core/v1:go_default_library",
        "@io_k8s_apimachinery//pkg/api/errors:go_default_library",
        "@io_k8s_apimachinery//pkg/apis/meta/v1:go_default_library",
        "@io_k8s_apimachinery//pkg/apis/meta/v1/unstructured:go_default_library",
        "@io_k8s_apimachinery//pkg/runtime:go_default_library",
        "@io_k8s_apimachinery//pkg/types:go_default_library",
        "@io_k8s_sigs_controller_runtime//pkg/client:client",
        "@io_k8s_sigs_controller_runtime//pkg/client/fake:fake",
    ],
)
