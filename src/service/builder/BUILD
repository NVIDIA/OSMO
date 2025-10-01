"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

load("//bzl:py.bzl", "osmo_py_binary")
load("@osmo_python_deps//:requirements.bzl", "requirement")


filegroup(
    name = "extra_hooks",
    srcs = glob(["extra_hooks/*.py"]),
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "service_builder",
    main = "builder.py",
    srcs = [
        "builder.py",
        ":extra_hooks",
        "//src/lib/data/storage:extra_hooks",
    ],
    deps = [
        requirement("pyinstaller"),
        requirement("kubernetes"),
        "//src/service/agent:agent_service_lib",
        "//src/service/core:service_lib",
        "//src/service/delayed_job_monitor:delayed_job_monitor_lib",
        "//src/service/logger:logger_lib",
        "//src/service/router:router_lib",
        "//src/service/worker:worker_lib",
    ],
    visibility = ["//visibility:public"],
)
