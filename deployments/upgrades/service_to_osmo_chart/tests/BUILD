# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_values_convert",
    srcs = ["test_values_convert.py"],
    deps = [
        "//deployments/upgrades/service_to_osmo_chart:values_convert_lib",
        requirement("pyyaml"),
    ],
)
