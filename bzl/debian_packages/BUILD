# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

# Debian package manifests and lockfiles for rules_distroless
#
# ## Regular Service Packages
# Files: debian_packages.yaml (amd64), debian_packages_arm64.yaml (arm64), *.lock.json (auto-generated)
# Used for: General service container images
#
# ### Making Changes
# 1. Edit debian_packages.yaml or debian_packages_arm64.yaml to add/remove packages
# 2. Regenerate locks: `bazel run @debian_packages//:lock && bazel run @debian_packages_arm64//:lock`
#
# ## Dev Builder Packages
# Files: dev_builder_debian_packages_x86_64.yaml, dev_builder_debian_packages_arm64.yaml, *.lock.json (auto-generated)
# Used for: Development builder container images (//src/build/builder) containing build tools and dependencies
#
# ### Making Changes
# 1. Edit dev_builder_debian_packages_x86_64.yaml or dev_builder_debian_packages_arm64.yaml to add/remove packages
# 2. Regenerate locks: `bazel run @dev_builder_debian_packages_x86_64//:lock && bazel run @dev_builder_debian_packages_arm64//:lock`

package(default_visibility = ["//visibility:public"])

exports_files([
    "debian_packages.yaml",
    "debian_packages.lock.json",
    "debian_packages_arm64.yaml",
    "debian_packages_arm64.lock.json",
    "dev_builder_debian_packages_arm64.yaml",
    "dev_builder_debian_packages_arm64.lock.json",
    "dev_builder_debian_packages_x86_64.yaml",
    "dev_builder_debian_packages_x86_64.lock.json",
])
