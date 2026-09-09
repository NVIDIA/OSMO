"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

sh_test(
    name = "test_validate_backend_image_runtimes",
    size = "small",
    srcs = ["tests/test_validate_backend_image_runtimes.sh"],
    args = ["$(rootpath :validate_backend_image_runtimes.sh)"],
    data = ["validate_backend_image_runtimes.sh"],
)
