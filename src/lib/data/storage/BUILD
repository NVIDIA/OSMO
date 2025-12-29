# gazelle:experimental_allow_relative_imports true
# gazelle:python_experimental_allow_relative_imports true

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

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

filegroup(
    name = "extra_hooks",
    srcs = glob(["extra_hooks/*.py"]),
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "storage",
    srcs = glob(["*.py"]),
    deps = [
        "//src/lib/utils:client_configs",
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:paths",
        "//src/lib/utils:osmo_errors",
        "//src/lib/data/storage/constants",
        "//src/lib/data/storage/credentials",
        "//src/lib/data/storage/core",
        "//src/lib/data/storage/backends",
        requirement("pydantic"),
    ],
)
