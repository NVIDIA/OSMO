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

load("@osmo_mypy_deps//:requirements.bzl", type_requirement = "requirement")
load("@osmo_python_deps//:requirements.bzl", app_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", test_requirement = "requirement")
load("@rules_mypy//mypy:mypy.bzl", "mypy_cli")

exports_files(
    [
        "mypy.ini",
        "mypy.bzl",
    ],
    visibility = ["//visibility:public"],
)

mypy_cli(
    name = "mypy_cli",
    mypy_requirement = type_requirement("mypy"),
    deps =[
        app_requirement("certifi"),
        app_requirement("fastapi"),
        app_requirement("jinja2"),
        app_requirement("lark"),
        app_requirement("mypy-boto3-iam"),
        app_requirement("mypy-boto3-s3"),
        app_requirement("mypy-boto3-sts"),
        app_requirement("opentelemetry-sdk"),
        app_requirement("pydantic"),
        app_requirement("pyjwt"),
        app_requirement("shtab"),
        app_requirement("slack_sdk"),
        app_requirement("texttable"),
        app_requirement("uvicorn"),
        type_requirement("types-boto3"),
        type_requirement("types-Deprecated"),
        type_requirement("types-PyYAML"),
        type_requirement("types-psycopg2"),
        type_requirement("types-pytz"),
        type_requirement("types-redis"),
        type_requirement("types-six"),
        type_requirement("types-tqdm"),
        type_requirement("types-urllib3"),
        type_requirement("types-aiofiles"),
    ],
    python_version = "3.10.18",
    tags = ["no-mypy"],
)
