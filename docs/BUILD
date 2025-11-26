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

# Build all documentation as a unified Sphinx project
filegroup(
    name = "all_docs_sources",
    srcs = glob([
        "_static/**",
        "_extensions/**",
        "_templates/**",
        "_redirect/**",
        "user_guide/**",
        "deployment_guide/**",
        "*.py",
        "*.rst",
        "*.svg",
        "*.png",
        "*.txt",
    ]),
)

copy_to_directory(
    name = "docs_copy",
    srcs = [":all_docs_sources"],
    out = "docs",
)
