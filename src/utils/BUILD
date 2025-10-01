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
    name = "static_config",
    srcs = [
        "static_config.py",
    ],
    deps = [
        requirement("pydantic"),
        requirement("pyyaml"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "auth",
    srcs = ["auth.py"],
    deps = [
        requirement("pydantic"),
        requirement("pyjwt"),
        requirement("jwcrypto"),
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "notify",
    srcs = ["notify.py"],
    data = [
        "//src/utils/resources:email_notification.html",
        "//src/utils/resources:osmo_logo.png",
    ],
    deps = [
        "//src/lib/utils:jinja_sandbox",
        requirement("pydantic"),
        requirement("slack_sdk"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "yaml",
    srcs = ["yaml.py"],
    deps = [
        requirement("pyyaml"),
    ],
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "backend_messages",
    srcs = ["backend_messages.py"],
    deps = [
        requirement("pydantic"),
        "//src/lib/utils:common",
        "//src/lib/utils:osmo_errors",
        "//src/utils/job:jobs_base",
    ],
    visibility = ["//visibility:public"],
)
