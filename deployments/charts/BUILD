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
filegroup(
    name = "service",
    srcs = glob(["service/**"]),
    visibility = ["//visibility:public"],
)

filegroup(
    name = "backend-operator",
    srcs = glob(["backend-operator/**"]),
    visibility = ["//visibility:public"],
)

filegroup(
    name = "osmo",
    srcs = glob(["osmo/**"]),
    visibility = ["//visibility:public"],
)

sh_test(
    name = "osmo_backend_token_bootstrap_test",
    srcs = ["osmo/tests/test_backend_token_bootstrap.sh"],
    data = ["osmo/files/backend-token-bootstrap.sh"],
)

sh_test(
    name = "osmo_mek_bootstrap_test",
    srcs = ["osmo/tests/test_mek_bootstrap.sh"],
    data = ["osmo/files/mek-bootstrap.sh"],
)

sh_test(
    name = "osmo_service_auth_bootstrap_test",
    srcs = ["osmo/tests/test_service_auth_bootstrap.sh"],
    data = [
        "osmo/files/service-auth-bootstrap.sh",
        "@@aspect_bazel_lib++toolchains+jq_toolchains//:resolved_toolchain",
    ],
)

sh_test(
    name = "osmo_object_storage_bootstrap_test",
    srcs = ["osmo/tests/test_object_storage_bootstrap.sh"],
    data = ["osmo/files/object-storage-bootstrap.sh"],
)
