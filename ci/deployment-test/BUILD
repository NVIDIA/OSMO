"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

exports_files([
    "azure-overrides.yaml",
    "check-head-chart-contract.sh",
    "fixtures/minio-storage-values.yaml",
])

sh_test(
    name = "test_check_head_chart_contract",
    srcs = ["tests/test_check_head_chart_contract.sh"],
    size = "small",
    data = [
        "azure-overrides.yaml",
        "check-head-chart-contract.sh",
        "fixtures/minio-storage-values.yaml",
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
        "//deployments:values/backend-operator.yaml",
        "//deployments:values/service.yaml",
        "//deployments/charts:backend-operator",
        "//deployments/charts:service",
    ],
)
