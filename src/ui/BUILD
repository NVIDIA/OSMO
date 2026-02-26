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

load("@osmo_constants//:constants.bzl", "BASE_IMAGE_URL", "IMAGE_TAG")

# Light Bazel bridge for the Next.js UI.
#
# The UI is built via its Dockerfile (not Bazel internals).
#
# Default repository and tags are loaded from @osmo_constants, matching the
# old oci_push rules. Override with explicit flags when needed:
#
#   bazel run @osmo_workspace//src/ui:build_push_web_ui_x86_64 -- \
#       --repository example.io/osmo/web-ui --tag custom
#
# The scripts accept the same --repository / --tag interface as oci_push rules.

package(default_visibility = ["//visibility:public"])

# Expose scripts as file targets so ci/push_images.py can find them via runfiles
exports_files([
    "scripts/build_push_web_ui_x86_64.sh",
    "scripts/build_push_web_ui_arm64.sh",
])

# sh_binary targets for direct `bazel run` usage.
#
# To build and push the web UI Docker image:
#
#   x86_64:  bazel run //src/ui:build_push_web_ui_x86_64
#   arm64:   bazel run //src/ui:build_push_web_ui_arm64
#
# You can override the repository and/or tag by passing arguments, e.g.:
#   bazel run //src/ui:build_push_web_ui_x86_64 -- --repository myrepo/web-ui --tag v1.2.3
#   bazel run //src/ui:build_push_web_ui_arm64 -- --repository myrepo/web-ui --tag v1.2.3

sh_binary(
    name = "build_push_web_ui_x86_64",
    srcs = ["scripts/build_push_web_ui_x86_64.sh"],
    args = ["--repository", BASE_IMAGE_URL + "web-ui"] +
           (["--tag", IMAGE_TAG + "-amd64"] if IMAGE_TAG else []),
    tags = ["manual"],
)

sh_binary(
    name = "build_push_web_ui_arm64",
    srcs = ["scripts/build_push_web_ui_arm64.sh"],
    args = ["--repository", BASE_IMAGE_URL + "web-ui"] +
           (["--tag", IMAGE_TAG + "-arm64"] if IMAGE_TAG else []),
    tags = ["manual"],
)
