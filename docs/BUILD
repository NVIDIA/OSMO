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

load("@osmo_workspace//bzl:py.bzl", "osmo_py_binary")
load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")
load("@aspect_bazel_lib//lib:run_binary.bzl", "run_binary")
load("@osmo_docs_deps//:requirements.bzl", "requirement")

package(default_visibility = ["//visibility:public"])

config_setting(
    name = "darwin",
    constraint_values = ["@platforms//os:osx"],
)

config_setting(
    name = "linux_arm64",
    constraint_values = [
        "@platforms//os:linux",
        "@platforms//cpu:arm64",
    ],
)

config_setting(
    name = "linux_x86_64",
    constraint_values = [
        "@platforms//os:linux",
        "@platforms//cpu:x86_64",
    ],
)

osmo_py_binary(
    name = "doc_builder",
    main = "doc_builder.py",
    srcs = ["doc_builder.py"],
    deps = [
        requirement("sphinx"),
        requirement("sphinx-copybutton"),
        requirement("sphinx-immaterial"),
        requirement("Sphinx-Substitution-Extensions"),
        requirement("sphinxcontrib-spelling"),
        requirement("sphinx-simplepdf"),
        requirement("sphinx-markdown-builder"),
        requirement("sphinx-new-tab-link"),
    ],
)

# Note: If running on Apple Silicon, please install enchant dependencies:
#
#   $ brew install enchant
#   $ pip install pyenchant
#
# The PYENCHANT_LIBRARY_PATH is automatically set for arm64 builds.
#
# Reference: https://github.com/pyenchant/pyenchant/issues/265

genrule(
    name = "process_symlinks",
    srcs = glob(["conf.py"]),
    outs = ["user_guide/conf.py", "deployment_guide/conf.py"],
    cmd = "cp -L $(location conf.py) $(location user_guide/conf.py) && cp -L $(location conf.py) $(location deployment_guide/conf.py)"
)

filegroup(
    name = "docs_sources",
    srcs = glob([
        "deployment_guide/**",
        "user_guide/**",
        "_static/**",
        "_templates/**",
        "_extensions/**",
    ]),
)

copy_to_directory(
    name = "docs_copy",
    srcs = [":docs_sources", ":process_symlinks"],
    out = "docs/",
)

run_binary(
    name = "user_docs",
    args = [
        "$(location :docs_copy)/user_guide",
        "--output_dir", "$(@D)",
        "--doctree_dir", "/tmp/user_docs/doctree",
    ],
    env = select({
        ":darwin": {
            "PYENCHANT_LIBRARY_PATH": "/opt/homebrew/lib/libenchant-2.dylib",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        ":linux_arm64": {
            "PYENCHANT_LIBRARY_PATH": "/usr/lib/aarch64-linux-gnu/libenchant-2.so.2",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        ":linux_x86_64": {
            "PYENCHANT_LIBRARY_PATH": "/usr/lib/x86_64-linux-gnu/libenchant-2.so.2",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        "//conditions:default": {
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
    }),
    out_dirs = ["user_docs"],
    tool = ":doc_builder",
    srcs = [":docs_copy"],
    visibility = ["//visibility:public"],
)

run_binary(
    name = "deployment_docs",
    args = [
        "$(location :docs_copy)/deployment_guide",
        "--output_dir", "$(@D)",
        "--doctree_dir", "/tmp/deployment_docs/doctree",
    ],
    env = select({
        ":darwin": {
            "PYENCHANT_LIBRARY_PATH": "/opt/homebrew/lib/libenchant-2.dylib",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        ":linux_arm64": {
            "PYENCHANT_LIBRARY_PATH": "/usr/lib/aarch64-linux-gnu/libenchant-2.so.2",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        ":linux_x86_64": {
            "PYENCHANT_LIBRARY_PATH": "/usr/lib/x86_64-linux-gnu/libenchant-2.so.2",
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
        "//conditions:default": {
            "OSMO_DOMAIN": "hexagon-sandbox",
        },
    }),
    out_dirs = ["deployment_docs"],
    tool = ":doc_builder",
    srcs = [":docs_copy"],
    visibility = ["//visibility:public"],
)
