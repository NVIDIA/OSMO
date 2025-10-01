#####################################################################################
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
#####################################################################################

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", osmo_requirement = "requirement")
load("@osmo_tests_python_deps//:requirements.bzl", test_requirement = "requirement")

genrule(
    name = "generate_ssl_certs",
    outs = ["cert.pem", "key.pem"],
    cmd = """
    mkdir -p $(@D) && \
    openssl genrsa -out $(@D)/key.pem 2048 && \
    openssl req -x509 -new -nodes -key $(@D)/key.pem \
        -sha256 -days 365 -out $(@D)/cert.pem \
        -subj '/C=US/ST=California/L=Santa Clara/O=Nvidia/OU=OSMO/CN=localhost/emailAddress=osmo-dev@exchange.nvidia.com'
    """,
    visibility = ["//visibility:public"],
)

osmo_py_library(
    name = "envoy",
    srcs = glob(["*.py"]),
    deps = [
        osmo_requirement("jinja2"),
        osmo_requirement("requests"),
        test_requirement("testcontainers"),
        "@rules_python//python/runfiles",
        "//src/tests/common/core",
    ],
    data = [
        "config.jinja",
        ":generate_ssl_certs",
    ],
    visibility = ["//visibility:public"],
)
