# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_test")

osmo_py_test(
    name = "test_coverage_targets",
    srcs = ["test_coverage_targets.py"],
    deps = ["//src/scripts/testbot"],
)

osmo_py_test(
    name = "test_guardrails",
    srcs = ["test_guardrails.py"],
    deps = ["//src/scripts/testbot"],
)

osmo_py_test(
    name = "test_respond",
    srcs = ["test_respond.py"],
    deps = ["//src/scripts/testbot"],
)

osmo_py_test(
    name = "test_create_pr",
    srcs = ["test_create_pr.py"],
    deps = ["//src/scripts/testbot"],
)
