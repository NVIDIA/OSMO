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
    name = "jobs_base",
    srcs = [
        "jobs_base.py",
    ],
    deps = [
        requirement("kombu"),
        requirement("pydantic"),
        "//src/lib/utils:osmo_errors",
        "//src/utils/connectors",
        "//src/utils/progress_check:progress_check_lib",
    ],
    visibility = ["//visibility:public"],
)

filegroup(
    name = "test_runner_cronjob_spec_file",
    srcs = glob(["test_runner_cronjob_spec/**"]),
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "backend_job",
    srcs = [
        "jobs_base.py",
        "backend_job_defs.py",
        "backend_jobs.py",
        "kb_methods.py"
    ],
    deps = [
        requirement("kombu"),
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("urllib3"),
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
        "//src/utils:backend_messages",
        "//src/utils/connectors",
        "//src/utils/progress_check:progress_check_lib",
    ],
    data = [
        "test_runner_cronjob_spec_file",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "job",
    srcs = [
        "jobs_base.py",
        "app.py",
        "backend_job_defs.py",
        "common.py",
        "jobs.py",
        "kb_objects.py",
        "task.py",
        "task_io.py",
        "workflow.py",
    ],
    deps = [
        requirement("kombu"),
        requirement("kubernetes"),
        requirement("redis"),
        requirement("pydantic"),
        requirement("pyyaml"),
        requirement("requests"),
        requirement("urllib3"),
        "//src/lib/data/constants",
        "//src/lib/data/storage",
        "//src/lib/utils:cache",
        "//src/lib/utils:common",
        "//src/lib/utils:credentials",
        "//src/lib/utils:jinja_sandbox",
        "//src/lib/utils:priority",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:workflow",
        "//src/utils:notify",
        "//src/utils:yaml",
        "//src/utils/connectors",
        "//src/utils/metrics",
        "//src/utils/progress_check:progress_check_lib",
    ],
    visibility = ["//visibility:public"],
)
