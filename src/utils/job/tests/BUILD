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

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "test_harness",
    srcs = [
        "test_harness.py",
    ],
    deps = [
        requirement("jinja2"),
        requirement("kombu"),
        requirement("kubernetes"),
        requirement("redis"),
        requirement("pydantic"),
        "//src/service/core/workflow",
        "//src/utils/connectors",
        "//src/utils/job",
        "//src/utils/job:backend_job",
        "//src/utils/metrics",
    ],
    visibility = ["//visibility:public"],
)

py_test(
    name = "job_test",
    srcs = [
        "job_test.py"
    ],
    tags = ["manual"],
    deps = [
        ":test_harness"
    ]
)

py_test(
    name = "test_workflow",
    srcs = [
        "test_workflow.py"
    ],
    tags = ["manual"],
    deps = [
        "//src/utils/job",
    ]
)

py_test(
    name = "test_task",
    srcs = [
        "test_task.py"
    ],
    tags = ["manual"],
    deps = [
        "//src/lib/utils:common",
        "//src/utils/connectors",
        "//src/utils/job",
    ]
)

py_test(
    name = "test_kb_objects",
    srcs = [
        "test_kb_objects.py"
    ],
    tags = ["manual"],
    deps = [
        "//src/utils/job",
    ]
)
