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

load("@aspect_rules_py//py:defs.bzl", "py_unpacked_wheel")
load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")
load("@osmo_wheel_requires//:requirements_from_txt.bzl", "WHEEL_REQUIRES")
load("@rules_python//python:packaging.bzl", "py_package")
load(":library.bzl", "osmo_py_wheel")

py_package(
    name = "osmo_pkg",
    deps = ["//src/lib"],
)

# Copies `src/lib/*` into a new directory `ci/library/osmo`
# All Python files in `src/lib` should use relative imports,
# making the directory portable.
copy_to_directory(
    name = "osmo_dir",
    srcs = [":osmo_pkg"],
    root_paths = ["src/lib"],
    out = "osmo",
)

# Creates two Python wheel targets:
#
# :osmo_py_wheel_stamped (for release)
# :osmo_py_wheel_stampless (for internal use in CI/CD)
#
# Refer to library.bzl for more details
osmo_py_wheel(
    name = "osmo_py_wheel",
    deps = [":osmo_dir"],
    requires = WHEEL_REQUIRES,
    distribution = "nvidia_osmo",
    python_requires = ">=3.10,<3.12",
    strip_path_prefixes = [
        # IMPORTANT: Removes the prefix of the current running directory.
        # This allows the Python Wheel to be installed under the namespace `osmo`.
        "src/lib/distribution",
    ],
    visibility = ["//visibility:public"],
)

py_unpacked_wheel(
    name = "osmo_py_wheel_unpacked",
    src = ":osmo_py_wheel_stampless",
    visibility = ["//visibility:public"],
)
