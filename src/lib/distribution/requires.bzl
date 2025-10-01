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


def _wheel_requires_repo_impl(ctx):
    """
    Creates a wheel_requires repo that contains a list of requirements
    generated from a requirements.txt file.

    This can be used in py_wheel targets to specify the requirements for the wheel.
    """
    src = ctx.path(ctx.attr.requirements_txt)
    content = ctx.read(src)

    # Extract requirements from requirements.txt
    reqs = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Skip pip flags/includes/vcs refs
        if line.startswith("-") or line.startswith("--") or line.startswith("git+"):
            continue
        reqs.append(line)

    # Create entries for the requirements list
    entries = []
    for req in reqs:
        entries.append('    "%s",' % req)

    # Create the body of the requirements_from_txt.bzl file
    body = "WHEEL_REQUIRES = [\n" + "\n".join(entries) + "\n]\n"

    ctx.file("BUILD.bazel", 'exports_files(["requirements_from_txt.bzl"])\n')
    ctx.file("requirements_from_txt.bzl", body)


wheel_requires_repo = repository_rule(
    implementation = _wheel_requires_repo_impl,
    attrs = {
        "requirements_txt": attr.label(allow_single_file = True, mandatory = True),
    },
)
