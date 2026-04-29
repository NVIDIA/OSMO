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

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")


osmo_py_library(
    name = "configmap_loader_lib",
    srcs = [
        "configmap_events.py",
        "configmap_guard.py",
        "configmap_loader.py",
    ],
    deps = [
        requirement("kubernetes"),
        requirement("pydantic"),
        requirement("pyyaml"),
        requirement("watchdog"),
        "//src/lib/utils:common",
        "//src/utils:configmap_state",
        "//src/utils/connectors",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "config",
    srcs = [
        "config_history_helpers.py",
        "config_service.py",
        "helpers.py",
        "objects.py",
    ],
    deps = [
        ":configmap_loader_lib",
        requirement("fastapi"),
        requirement("pydantic"),
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
        "//src/lib/utils:config_history",
        "//src/service/core/workflow:workflow",
        "//src/utils:configmap_state",
        "//src/utils/connectors",
        "//src/utils/job:job",
        "//src/utils/job:backend_job",
    ],
    visibility = ["//visibility:public"],
)
