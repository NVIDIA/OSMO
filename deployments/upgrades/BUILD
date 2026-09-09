# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "export_configs_to_helm",
    srcs = ["export_configs_to_helm.py"],
    deps = [
        requirement("pyyaml"),
        "//src/service/core/config:configmap_loader_lib",
    ],
    visibility = ["//visibility:public"],
)
