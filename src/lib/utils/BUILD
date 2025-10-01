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

package(default_visibility = ["//visibility:public"])

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

exports_files(
    [
        "version.yaml",
        "py.typed",
    ],
)

osmo_py_library(
    name = "priority",
    srcs = ["priority.py"]
)

osmo_py_library(
    name = "cache",
    srcs = ["cache.py"],
    deps = [
        requirement("pydantic"),
    ],
)

osmo_py_library(
    name = "jinja_sandbox",
    srcs = ["jinja_sandbox.py"],
    deps = [
        requirement("jinja2"),
        "//src/lib/utils:osmo_errors",
    ],
)

osmo_py_library(
    name = "client",
    srcs = ["client.py"],
    deps = [
        requirement("certifi"),
        requirement("requests"),
        requirement("pyyaml"),
        requirement("urllib3"),
        requirement("websockets"),
        requirement("websocket-client"),
        ":client_configs",
        ":login",
        ":osmo_errors",
        ":version",
    ],
)

osmo_py_library(
    name = "client_configs",
    srcs = ["client_configs.py"],
    deps = [
        requirement("pyyaml"),
        ":cache",
        ":common",
        ":credentials",
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "common",
    srcs = ["common.py"],
    deps = [
        requirement("fastapi"),
        requirement("pydantic"),
        requirement("pytz"),
        requirement("requests"),
        requirement("texttable"),
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "credentials",
    srcs = ["credentials.py"],
    deps = [
        requirement("pydantic"),
        ":osmo_errors",
        "//src/lib/data/constants",
    ],
)

osmo_py_library(
    name = "logging",
    srcs = ["logging.py"],
    deps = [
        requirement("pydantic"),
    ],
)

osmo_py_library(
    name = "login",
    srcs = ["login.py"],
    deps = [
        requirement("pydantic"),
        requirement("requests"),
        requirement("urllib3"),
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "osmo_errors",
    srcs = ["osmo_errors.py"],
)

osmo_py_library(
    name = "paths",
    srcs = ["paths.py"],
    deps = [],
)

osmo_py_library(
    name = "port_forward",
    srcs = ["port_forward.py"],
    deps = [
        requirement("requests"),
        requirement("websockets"),
        requirement("websocket-client"),
        ":client",
        ":common",
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "role",
    srcs = ["role.py"],
    deps = [
        requirement("pydantic"),
        ":osmo_errors"
    ],
)

osmo_py_library(
    name = "validation",
    srcs = ["validation.py"],
    deps = [
        ":common",
        ":osmo_errors",
        "//src/lib/data/constants",
    ],
)

osmo_py_library(
    name = "version",
    srcs = ["version.py"],
    data = [
        "version.yaml",
    ],
    deps = [
        requirement("pydantic"),
        requirement("pyyaml"),
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "workflow",
    srcs = ["workflow.py"],
    deps = [
        requirement("pydantic"),
        requirement("pyyaml"),
        ":osmo_errors",
    ],
)

osmo_py_library(
    name = "config_history",
    srcs = ["config_history.py"],
    deps = [
        ":osmo_errors",
    ],
)
