"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

load("//bzl:py.bzl", "osmo_py_library", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", osmo_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", osmo_tests_requirement = "requirement")

osmo_py_test(
    name = "test_service",
    srcs = ["test_service.py"],
    deps = [
        ":fixture",
        "//src/lib/utils:common",
        "//src/lib/utils:credentials",
        "//src/lib/utils:priority",
        "//src/lib/utils:version",
        "//src/service/core:service_lib",
        "//src/tests/common",
        "//src/tests/common/storage",
    ],
    size = "large",
    tags = [
        "requires-network",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "fixture",
    srcs = ["fixture.py"],
    deps = [
        osmo_requirement("fastapi"),
        osmo_tests_requirement("httpx"),
        "//src/lib/utils:common",
        "//src/service/core:service_lib",
        "//src/tests/common",
        "//src/tests/common/storage",
    ],
    visibility = ["//visibility:public"],
)
