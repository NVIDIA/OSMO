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

load("@io_bazel_rules_go//go:def.bzl", "go_library")

go_library(
    name = "runner",
    srcs = ["runner.go"],
    importpath = "go.corp.nvidia.com/osmo/controller/runner",
    visibility = ["//visibility:public"],
    deps = [
        "//src/apis/workflow/v1alpha1",
        "//src/controller/dispatcher",
        "//src/controller/periodic",
        "@io_k8s_apimachinery//pkg/apis/meta/v1/unstructured",
        "@io_k8s_apimachinery//pkg/runtime/schema",
        "@io_k8s_client_go//dynamic",
        "@io_k8s_client_go//dynamic/dynamicinformer",
        "@io_k8s_client_go//tools/cache",
        "@io_k8s_client_go//util/workqueue",
    ],
)
