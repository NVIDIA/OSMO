# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

package(default_visibility = ["//visibility:public"])

load("//bzl:py.bzl", "osmo_py_library", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "smoke",
    srcs = [
        "__init__.py",
        "smoke_test_base.py",
    ],
    deps = [
        "//src/lib/data/storage",
        "//src/lib/data/storage/core",
    ],
)

osmo_py_test(
    name = "test_azure",
    srcs = ["test_azure.py"],
    deps = [
        ":smoke",
        "//src/lib/utils:credentials",
        "//src/lib/utils:osmo_errors",
        requirement("pydantic"),
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
    timeout = "long",
)

osmo_py_test(
    name = "test_gs",
    srcs = ["test_gs.py"],
    deps = [
        ":smoke",
        "//src/lib/utils:credentials",
        "//src/lib/utils:osmo_errors",
        requirement("pydantic"),
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
    timeout = "long",
)

osmo_py_test(
    name = "test_s3",
    srcs = ["test_s3.py"],
    deps = [
        ":smoke",
        "//src/lib/utils:credentials",
        "//src/lib/utils:osmo_errors",
        requirement("pydantic"),
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
    timeout = "long",
)

osmo_py_test(
    name = "test_swift",
    srcs = ["test_swift.py"],
    deps = [
        ":smoke",
        "//src/lib/utils:credentials",
        "//src/lib/utils:osmo_errors",
        requirement("pydantic"),
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
    timeout = "long",
)

osmo_py_test(
    name = "test_tos",
    srcs = ["test_tos.py"],
    deps = [
        ":smoke",
        "//src/lib/utils:credentials",
        "//src/lib/utils:osmo_errors",
        requirement("pydantic"),
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
    timeout = "long",
)

osmo_py_test(
    name = "test_execution",
    srcs = ["test_execution.py"],
    deps = [
        "//src/lib/data/storage",
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
)

osmo_py_test(
    name = "test_mux",
    srcs = ["test_mux.py"],
    deps = [
        "//src/lib/data/storage",
        "//src/lib/data/storage/core",
    ],
    tags = [
        "manual",
        "no-sandbox",
        "requires-network",
    ],
)
