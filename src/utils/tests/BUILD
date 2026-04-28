"""
SPDX-FileCopyrightText: NVIDIA CORPORATION
Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement") 

osmo_py_test(
    name = "test_auth",
    srcs = [
        "test_auth.py"
    ],
    deps = [
        "//src/utils:auth",
        requirement("jwcrypto"),
    ]
)

py_test(
    name = "test_standalone_executor",
    srcs = ["test_standalone_executor.py"],
    deps = [
        "//src/utils:standalone_executor",
    ],
    data = [
        "//cookbook/tutorials:tutorial_specs",
    ],
    local = True,
)

py_test(
    name = "test_compose_executor",
    srcs = ["test_compose_executor.py"],
    deps = [
        "//src/utils:compose_executor",
        "//src/utils:standalone_executor",
    ],
    local = True,
)
