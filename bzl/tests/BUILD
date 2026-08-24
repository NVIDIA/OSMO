# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

py_test(
    name = "python_runtime_tar_test",
    srcs = ["python_runtime_tar_test.py"],
    args = [
        "$(rootpath //src:python_runtime_tar_amd64)",
        "$(rootpath //src:python_runtime_binary_amd64)",
    ],
    data = [
        "//src:python_runtime_binary_amd64",
        "//src:python_runtime_tar_amd64",
    ],
)

py_test(
    name = "python_runtime_tar_arm64_test",
    srcs = ["python_runtime_tar_test.py"],
    args = [
        "$(rootpath //src:python_runtime_tar_arm64)",
        "$(rootpath //src:python_runtime_binary_arm64)",
    ],
    data = [
        "//src:python_runtime_binary_arm64",
        "//src:python_runtime_tar_arm64",
    ],
    main = "python_runtime_tar_test.py",
)

py_test(
    name = "python_image_runtime_dedup_test",
    srcs = ["python_image_runtime_dedup_test.py"],
    args = [
        "$(rootpath //src/service/router:router_image_x86_64)",
        "1",
    ],
    data = ["//src/service/router:router_image_x86_64"],
)

py_test(
    name = "non_python_image_runtime_test",
    srcs = ["python_image_runtime_dedup_test.py"],
    args = [
        "$(rootpath //src/service/authz_sidecar:authz_sidecar_image_x86_64)",
        "0",
    ],
    data = ["//src/service/authz_sidecar:authz_sidecar_image_x86_64"],
    main = "python_image_runtime_dedup_test.py",
)

py_test(
    name = "oci_image_contract_test",
    srcs = ["oci_image_contract_test.py"],
    args = ["$(rootpath //src/service/router:router_image_x86_64)"],
    data = ["//src/service/router:router_image_x86_64"],
)
