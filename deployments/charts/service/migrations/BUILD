# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

load("//bzl:py.bzl", "osmo_py_test")

osmo_py_test(
    name = "test_run_migrations",
    srcs = ["test_run_migrations.py"],
    data = [
        "run_migrations.sh",
    ] + glob(["0*.json"]),
)
