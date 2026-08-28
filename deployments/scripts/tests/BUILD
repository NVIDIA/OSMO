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

sh_test(
    name = "test_mek_generation_guard",
    srcs = ["test_mek_generation_guard.sh"],
    data = [
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
    ],
)

sh_test(
    name = "test_deploy_osmo_umbrella_single_plane",
    size = "small",
    srcs = ["test_deploy_osmo_umbrella_single_plane.sh"],
    data = [
        "//deployments/charts:osmo",
        "//deployments:scripts/deploy-osmo-umbrella-single-plane.sh",
        "//deployments:scripts/single-plane-azure.yaml.envsubst",
        "//deployments:scripts/verify.sh",
    ],
)

sh_test(
    name = "test_verify",
    size = "small",
    srcs = ["test_verify.sh"],
    data = [
        "//deployments:scripts/common.sh",
        "//deployments:scripts/verify.sh",
        "//deployments:workflows/verify-hello.yaml",
    ],
)
