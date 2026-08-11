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

load("@osmo_python_deps//:requirements.bzl", "requirement")
load("//bzl:py.bzl", "osmo_py_test")

osmo_py_test(
    name = "test_objects",
    srcs = ["test_objects.py"],
    deps = [
        "//src/service/agent:helpers",
        "//src/utils/job",
    ],
)

osmo_py_test(
    name = "test_helpers",
    srcs = ["test_helpers.py"],
    deps = [
        requirement("fastapi"),
        "//src/lib/utils:common",
        "//src/lib/utils:logging",
        "//src/lib/utils:osmo_errors",
        "//src/service/agent:helpers",
        "//src/service/core/config",
        "//src/service/core/workflow",
        "//src/utils:backend_messages",
        "//src/utils/connectors",
        "//src/utils/job",
        "//src/utils/job:backend_job",
        "//src/utils/metrics",
    ],
)
