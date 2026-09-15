"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

load("//bzl:py.bzl", "osmo_py_binary", "osmo_py_library", "osmo_py_test")

# Developer-only tooling; no dependency from the service or image targets.
osmo_py_library(
    name = "tool_reference_lib",
    testonly = True,
    srcs = ["generate_tool_reference.py"],
    deps = ["//src/service/mcp:tools"],
)

osmo_py_binary(
    name = "generate_tool_reference",
    testonly = True,
    srcs = ["generate_tool_reference.py"],
    main = "generate_tool_reference.py",
    deps = [":tool_reference_lib"],
)

osmo_py_test(
    name = "test_tool_reference",
    srcs = ["test_tool_reference.py"],
    data = ["TOOL_REFERENCE.md"],
    deps = [
        ":tool_reference_lib",
        "//src/service/mcp:tools",
    ],
)
