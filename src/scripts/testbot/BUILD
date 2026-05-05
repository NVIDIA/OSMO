# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library")

osmo_py_library(
    name = "testbot",
    srcs = glob(["*.py"]),
    data = [
        "SELECT_TARGETS_PROMPT.md",
        "TESTBOT_PROMPT.md",
    ],
    visibility = ["//visibility:public"],
)

osmo_py_binary(
    name = "criticality_scorer",
    srcs = ["criticality_scorer.py"],
    main = "criticality_scorer.py",
    deps = [":testbot"],
)

osmo_py_binary(
    name = "select_targets_agent",
    srcs = ["select_targets_agent.py"],
    main = "select_targets_agent.py",
    data = ["SELECT_TARGETS_PROMPT.md"],
    deps = [":testbot"],
)
