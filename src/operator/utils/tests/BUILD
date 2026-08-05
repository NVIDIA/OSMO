"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

load("//bzl:py.bzl", "osmo_py_test")

osmo_py_test(
    name = "test_login",
    srcs = ["test_login.py"],
    deps = [
        "//src/lib/utils:login",
        "//src/operator/utils:login",
    ],
    visibility = ["//visibility:public"],
)
