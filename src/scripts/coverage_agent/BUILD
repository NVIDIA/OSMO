# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_binary")

osmo_py_binary(
    name = "coverage_agent",
    main = "main.py",
    srcs = glob(["**/*.py"]),
    deps = [
        # langchain/langgraph deps are installed via pip in CI (not Bazel-managed for v1).
        # See src/agent_requirements.txt.
    ],
    visibility = ["//visibility:public"],
)
