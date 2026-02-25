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
"""

# Light Bazel bridge for the Next.js UI.
#
# The UI is built via its Dockerfile (not Bazel internals).
#
# Usage:
#   bazel run @osmo_workspace//src/ui:build_push_web_ui_x86_64 -- \
#       --repository example.io/osmo/web-ui --tag latest
#
# The scripts accept the same --repository / --tag interface as oci_push rules.

package(default_visibility = ["//visibility:public"])

sh_binary(
    name = "build_push_web_ui_x86_64",
    srcs = ["scripts/build_push_web_ui_x86_64.sh"],
    tags = ["manual"],
)

sh_binary(
    name = "build_push_web_ui_arm64",
    srcs = ["scripts/build_push_web_ui_arm64.sh"],
    tags = ["manual"],
)
