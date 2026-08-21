"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

Rules for selecting the runtime-only portion of a rules_python toolchain.
"""

def _python_runtime_files_impl(ctx):
    if ctx.attr.component == "binary":
        selected = [
            file
            for file in ctx.files.runtime
            if file.short_path.endswith("/bin/python3.14")
        ]
        if len(selected) != 1:
            fail("expected one bin/python3.14, found {}".format(len(selected)))
    else:
        selected = [
            file
            for file in ctx.files.runtime
            if "/lib/python3.14/" in file.short_path
        ]
        if not selected:
            fail("expected files beneath lib/python3.14")

    return [DefaultInfo(files = depset(selected))]

python_runtime_files = rule(
    implementation = _python_runtime_files_impl,
    attrs = {
        "component": attr.string(
            mandatory = True,
            values = ["binary", "stdlib"],
        ),
        "runtime": attr.label(
            mandatory = True,
            allow_files = True,
        ),
    },
)
