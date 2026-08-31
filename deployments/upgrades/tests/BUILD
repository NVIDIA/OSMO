# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

osmo_py_test(
    name = "test_adopt_configmap_roles",
    srcs = ["test_adopt_configmap_roles.py"],
    deps = [
        "//deployments/upgrades:adopt_configmap_roles",
        requirement("pyyaml"),
    ],
)

osmo_py_test(
    name = "test_adopt_configmap_roles_postgres",
    srcs = ["test_adopt_configmap_roles_postgres.py"],
    deps = [
        "//deployments/upgrades:adopt_configmap_roles",
        requirement("psycopg2-binary"),
    ],
)

osmo_py_test(
    name = "test_export_configs_to_helm",
    srcs = ["test_export_configs_to_helm.py"],
    deps = [
        "//deployments/upgrades:export_configs_to_helm",
        requirement("pyyaml"),
    ],
)
