# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_library(
    name = "adopt_configmap_roles",
    srcs = ["adopt_configmap_roles.py"],
    deps = [
        requirement("psycopg2-binary"),
        requirement("pyyaml"),
        "//src/lib/utils:role",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "adopt_configmap_roles_binary",
    main = "adopt_configmap_roles.py",
    srcs = ["adopt_configmap_roles.py"],
    deps = [":adopt_configmap_roles"],
)

osmo_py_library(
    name = "export_configs_to_helm",
    srcs = ["export_configs_to_helm.py"],
    deps = [
        requirement("pyyaml"),
        "//src/service/core/config:configmap_loader_lib",
    ],
    visibility = ["//visibility:public"],
)
