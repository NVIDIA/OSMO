# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
load("@osmo_python_deps//:requirements.bzl", osmo_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", osmo_tests_requirement = "requirement")

osmo_py_test(
    name = "test_workflow_service",
    srcs = ["test_workflow_service.py"],
    deps = [
        "//src/service/core:service_lib",
        "//src/tests/common",
        "//src/tests/common/registry",
        osmo_requirement("fastapi"),
        osmo_tests_requirement("httpx"),
        osmo_tests_requirement("testcontainers"),
    ],
    tags = [
        "requires-network",
    ],
    visibility = ["//visibility:public"],
)

py_test(
    name = "test_calculate_pool_quotas",
    srcs = ["test_calculate_pool_quotas.py"],
    deps = [
        "//src/service/core/workflow",
        "//src/utils/connectors",
        "//src/utils/job",
    ],
)

