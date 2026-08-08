"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

sh_test(
    name = "test_backend_token_generation",
    srcs = ["test_backend_token_generation.sh"],
    data = [
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
    ],
)

sh_test(
    name = "test_private_azure_backend_token",
    srcs = ["test_private_azure_backend_token.sh"],
    data = [
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
    ],
)
