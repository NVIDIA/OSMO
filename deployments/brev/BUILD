"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

load("@rules_shell//shell:sh_test.bzl", "sh_test")

config_setting(
    name = "linux_x86_64",
    constraint_values = [
        "@platforms//os:linux",
        "@platforms//cpu:x86_64",
    ],
)

config_setting(
    name = "macos_arm64",
    constraint_values = [
        "@platforms//os:macos",
        "@platforms//cpu:arm64",
    ],
)

sh_test(
    name = "shellcheck",
    srcs = ["shellcheck_test.sh"],
    data = ["setup.sh"] + select({
        ":linux_x86_64": ["@shellcheck_linux_x86_64//:shellcheck"],
        ":macos_arm64": ["@shellcheck_darwin_arm64//:shellcheck"],
    }),
    env = select({
        ":linux_x86_64": {
            "SHELLCHECK": "$(location @shellcheck_linux_x86_64//:shellcheck)",
            "SETUP_SH": "$(location setup.sh)",
        },
        ":macos_arm64": {
            "SHELLCHECK": "$(location @shellcheck_darwin_arm64//:shellcheck)",
            "SETUP_SH": "$(location setup.sh)",
        },
    }),
)
