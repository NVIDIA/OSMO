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

load("@pylint_python_deps//:requirements.bzl", "requirement")

def _py_lint_test(name, srcs, tags):
    """
    Creates a py_test that lints all python source files provided with pylint
    """
    if not srcs:
        return

    tags = list(tags)
    if "manual" in tags:
        # We still want to run lint on manual test targets
        tags.remove("manual")

    native.py_test(
        name = name,
        main = "@osmo_workspace//bzl/linting:pylint.py",
        srcs = ["@osmo_workspace//bzl/linting:pylint.py"],
        deps = [
            requirement("pylint"),
            requirement("pyyaml"),
        ],
        data = ["@osmo_workspace//bzl/linting:pylintrc"] + srcs,
        args = ["--rcfile=$(location @osmo_workspace//bzl/linting:pylintrc)"] +
               ["$(locations {})".format(src) for src in srcs],
        tags = ["lint", "no-mypy"] + tags,
    )

def osmo_py_library(
    name,
    srcs = [],
    deps = [],
    tags = [],
    **kwargs):
    """
    Creates a py_library with linting and strict type-checking
    """

    _py_lint_test(
        name = name + "-pylint",
        srcs = srcs,
        tags = tags,
    )

    native.py_library(
        name = name,
        deps = deps,
        srcs = srcs,
        tags = tags,
        **kwargs
    )

def osmo_py_binary(
    name,
    main,
    data = [],
    deps = [],
    srcs = [],
    tags = [],
    **kwargs):

    _py_lint_test(
        name = name + "-pylint",
        srcs = srcs,
        tags = tags,
    )

    native.py_binary(
        name = name,
        main = main,
        data = data,
        deps = deps,
        srcs = srcs,
        tags = tags,
        **kwargs
    )

def osmo_py_test(
    name,
    deps = [],
    srcs = [],
    tags = [],
    **kwargs):

    _py_lint_test(
        name = name + "-pylint",
        srcs = srcs,
        tags = tags,
    )

    native.py_test(
        name = name,
        deps = deps,
        srcs = srcs,
        tags = tags,
        **kwargs
    )
