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
    name = "service_python_runtime_dedup_test",
    srcs = ["python_image_runtime_dedup_test.py"],
    args = [
        "$(rootpath //src/service/core:service_image_x86_64)",
        "1",
    ],
    data = ["//src/service/core:service_image_x86_64"],
    main = "python_image_runtime_dedup_test.py",
)

py_test(
    name = "mcp_python_runtime_dedup_test",
    srcs = ["python_image_runtime_dedup_test.py"],
    args = [
        "$(rootpath //src/service/mcp:mcp_image_x86_64)",
        "1",
    ],
    data = ["//src/service/mcp:mcp_image_x86_64"],
    main = "python_image_runtime_dedup_test.py",
)

py_test(
    name = "service_python_runfiles_dedup_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/service/core:service_image_x86_64)",
        "src/service/core/service_binary.runfiles",
        "usr/bin/mek-lifecycle",
        "src/utils/secret_manager/mek_lifecycle.py",
    ],
    data = ["//src/service/core:service_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
)

py_test(
    name = "service_auth_bootstrap_python_runfiles_dedup_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/service/core:service_image_x86_64)",
        "src/service/core/service_binary.runfiles",
        "usr/bin/service-auth-bootstrap",
        "src/service/core/service_auth_bootstrap.py",
    ],
    data = ["//src/service/core:service_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
)

py_test(
    name = "mcp_python_runfiles_dedup_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/service/mcp:mcp_image_x86_64)",
        "src/service/mcp/mcp_binary.runfiles",
    ],
    data = ["//src/service/mcp:mcp_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
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

py_test(
    name = "backend_listener_image_runfiles_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/operator:backend_listener_image_x86_64)",
        "src/operator/backend_listener_binary.runfiles",
        "usr/bin/backend_listener",
        "src/operator/backend_listener.py",
    ],
    data = ["//src/operator:backend_listener_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
)

py_test(
    name = "backend_worker_image_runfiles_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/operator:backend_worker_image_x86_64)",
        "src/operator/backend_worker_binary.runfiles",
        "usr/bin/backend_worker",
        "src/operator/backend_worker.py",
    ],
    data = ["//src/operator:backend_worker_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
)

py_test(
    name = "backend_test_runner_image_runfiles_test",
    srcs = ["python_image_runfiles_dedup_test.py"],
    args = [
        "$(rootpath //src/operator/backend_test_runner:backend_test_runner_image_x86_64)",
        "src/operator/backend_test_runner/backend_test_runner_binary.runfiles",
        "usr/bin/backend_test_runner",
        "src/operator/backend_test_runner/backend_test_runner.py",
    ],
    data = ["//src/operator/backend_test_runner:backend_test_runner_image_x86_64"],
    main = "python_image_runfiles_dedup_test.py",
)

test_suite(
    name = "backend_operator_image_tests",
    tests = [
        ":backend_listener_image_runfiles_test",
        ":backend_test_runner_image_runfiles_test",
        ":backend_worker_image_runfiles_test",
    ],
)
