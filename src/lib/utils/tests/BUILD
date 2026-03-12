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

load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_dataset",
    srcs = ["test_dataset.py"],
    deps = [
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
    ]
)

osmo_py_test(
    name = "test_common",
    srcs = ["test_common.py"],
    deps = [
        "//src/lib/utils:common",
    ]
)


osmo_py_test(
    name = "test_jinja_sandbox",
    srcs = ["test_jinja_sandbox.py"],
    deps = [
        "//src/lib/utils:jinja_sandbox",
    ]
)
