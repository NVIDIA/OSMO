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

load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")

package(default_visibility = ["//visibility:public"])

filegroup(
    name = "root_docs_sources",
    srcs = glob([
        "_static/**",
        "_extensions/**",
        "conf.py",
        "index.rst",
        "docs_options.svg",
    ]),
)

copy_to_directory(
    name = "root_docs_copy",
    srcs = [":root_docs_sources"],
    out = "root_docs",
)

filegroup(
    name = "user_guide_sources",
    srcs = glob([
        "_static/**",
        "_extensions/**",
        "_templates/**",
        "user_guide/**",
        "conf.py",
    ]),
)

copy_to_directory(
    name = "user_guide_copy",
    srcs = [":user_guide_sources"],
    out = "user_guide",
)

filegroup(
    name = "deployment_guide_sources",
    srcs = glob([
        "_static/**",
        "_extensions/**",
        "_templates/**",
        "deployment_guide/**",
        "conf.py",
    ]),
)

copy_to_directory(
    name = "deployment_guide_copy",
    srcs = [":deployment_guide_sources"],
    out = "deployment_guide",
)
