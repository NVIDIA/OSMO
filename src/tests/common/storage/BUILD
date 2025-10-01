#####################################################################################
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
#####################################################################################

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_mypy_deps//:requirements.bzl", type_requirement = "requirement")
load("@osmo_python_deps//:requirements.bzl", osmo_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", test_requirement = "requirement")

osmo_py_library(
    name = "storage",
    srcs = glob(["*.py"]),
    deps = [
        osmo_requirement("requests"),
        test_requirement("testcontainers"),
        type_requirement("types-boto3"),
        "//src/tests/common/core",
    ],
    visibility = ["//visibility:public"],
)
