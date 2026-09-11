# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

filegroup(
    name = "workflows",
    srcs = glob(
        [
            "*.yaml",
        ],
    ),
    visibility = ["//src/scripts/testbot/tests:__pkg__"],
)

exports_files(
    ["deployment-test.yaml"],
    visibility = ["//ci/deployment-test:__pkg__"],
)
