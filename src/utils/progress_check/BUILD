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

load("@aspect_rules_py//py:defs.bzl", "py_image_layer")
load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_python_wrapper")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "progress_check_lib",
    srcs = [
        "progress.py",
        "progress_check.py",
    ],
    deps = [
        requirement("pydantic"),
        requirement("aiofiles"),
        "//src/utils:static_config",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "progress_check_binary",
    srcs = ["progress_check.py"],
    main = "progress_check.py",
    deps = [
        ":progress_check_lib",
    ],
)

py_image_layer(
    name = "progress_check_layer",
    binary = ":progress_check_binary",
)

osmo_python_wrapper(
    name = "progress_check_wrapper",
    bin_name = "progress_check",
    main = "/src/utils/progress_check/progress_check.py",
    runfiles_dir = "/src/utils/progress_check/progress_check_binary.runfiles",
)

filegroup(
    name = "progress_check_image_layers",
    srcs = [
        ":progress_check_layer_default",
        ":progress_check_layer_packages",
        ":progress_check_wrapper",
    ],
    visibility = ["//visibility:public"],
)
