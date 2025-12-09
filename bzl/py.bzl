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
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")

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

def osmo_python_wrapper(
        name,
        bin_name,
        main,
        runfiles_dir,
        package_dir = "/usr/bin",
        python_interpreter = "/usr/bin/python3"):

    # Generate the wrapper script
    wrapper_target = name + "_script"
    native.genrule(
        name = wrapper_target,
        outs = [bin_name],
        cmd = """
            cat > $@ << 'EOF'
#!{python_interpreter}
import os
import sys
import glob

# Set up PYTHONPATH to include app code and dependencies
pythonpath = ["{runfiles_dir}/_main"]
local_runfiles_dir = "{runfiles_dir}"
local_main_dir = "{runfiles_dir}/_main"
if os.path.isdir("/osmo_workspace+"):
    local_runfiles_dir = "/osmo_workspace+" + local_runfiles_dir
    local_main_dir = local_runfiles_dir + "/osmo_workspace+"
    pythonpath.append(local_runfiles_dir + "/osmo_workspace+")

# Add all site-packages directories
site_packages = glob.glob(local_runfiles_dir + "/rules_python++pip+*/site-packages")
pythonpath.extend(site_packages)

# Set PYTHONPATH
os.environ["PYTHONPATH"] = ":".join(pythonpath)

# Execute target script directly with system Python
os.execv("{python_interpreter}", ["{python_interpreter}", local_main_dir + "{main}"] + sys.argv[1:])
EOF
            chmod +x $@
        """.format(
            python_interpreter = python_interpreter,
            runfiles_dir = runfiles_dir,
            main = main,
        ),
    )

    # Package the wrapper into a tarball
    pkg_tar(
        name = name,
        extension = "tgz",
        srcs = [wrapper_target],
        mode = "0755",
        package_dir = package_dir,
    )
