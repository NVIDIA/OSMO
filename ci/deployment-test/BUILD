"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

exports_files([
    "azure-overrides.yaml",
    "check-released-chart-compat.sh",
    "fixtures/minio-storage-values.yaml",
])

sh_test(
    name = "test_check_released_chart_compat",
    srcs = ["tests/test_check_released_chart_compat.sh"],
    size = "small",
    data = [
        "azure-overrides.yaml",
        "check-released-chart-compat.sh",
        "fixtures/minio-storage-values.yaml",
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
        "//deployments:values/backend-operator.yaml",
        "//deployments:values/service.yaml",
    ],
)
