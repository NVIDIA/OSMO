# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "values_convert_lib",
    srcs = ["values_convert.py"],
    deps = [requirement("pyyaml")],
    visibility = ["//deployments/upgrades/service_to_osmo_chart/tests:__pkg__"],
)

osmo_py_binary(
    name = "values_convert",
    srcs = ["values_convert.py"],
    main = "values_convert.py",
    deps = [requirement("pyyaml")],
)
