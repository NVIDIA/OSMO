# # SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

load("@rules_python//python:packaging.bzl", "py_wheel", "py_wheel_dist")

def _py_wheel_dist_runfiles_impl(ctx):
    """
    Creates a runfiles target for the original py_wheel_dist target.

    This is necessary to ensure that the wheel file is available for other
    bazel targets when used as a `data` dependency.
    """
    original_target = ctx.attr.original_target[DefaultInfo]
    return [
        DefaultInfo(
            files = original_target.files,
            runfiles = ctx.runfiles(transitive_files = original_target.files),
        ),
    ]

py_wheel_dist_runfiles = rule(
    implementation = _py_wheel_dist_runfiles_impl,
    attrs = {
        "original_target": attr.label(mandatory = True),
    },
)

def osmo_py_wheel(name, **kwargs):
    """
    Creates two Python wheel targets:
    - one without a stamped version (for internal use in CI/CD)
    - one with a stamped version (for release)
    """
    if "version" in kwargs:
        fail("Library version is automatically generated and should not be manually set")

    if "distribution" not in kwargs:
        fail("Distribution must be set")

    py_wheel(
        name = name + "_stampless",
        version = "0.0.0",
        **kwargs
    )

    native.alias(
        name = name,
        actual = ":" + name + "_stampless",
        visibility = ["//visibility:public"],
    )

    # Refer to stamp.sh for more details
    py_wheel(
        name = name + "_stamped",
        version = "{STABLE_VERSION}{STABLE_DEV_LABEL}{VOLATILE_TIMESTAMP}{STABLE_HASH_SUFFIX}",
        **kwargs
    )

    # Creates a Python wheel distribution
    #
    # For development release (e.g. 1.0.0.dev202503090000+git.abc123):
    # $ bazel build --config=stamp_py_wheel //src/lib/distribution:osmo_py_wheel_dist
    #
    # For official release (e.g. 1.0.0):
    # $ RELEASE_WHEEL='true' bazel build --config=stamp_py_wheel //src/lib/distribution:osmo_py_wheel_dist
    py_wheel_dist(
        name = name + "_dist",
        wheel = ":" + name + "_stamped",
        out = kwargs["distribution"],
        visibility = ["//visibility:public"],
    )

    py_wheel_dist_runfiles(
        name = name + "_dist_runfiles",
        original_target = ":" + name + "_dist",
        visibility = ["//visibility:public"],
    )
