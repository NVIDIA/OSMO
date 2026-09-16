"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

sh_test(
    name = "test_azure_terraform_driver",
    size = "small",
    srcs = ["test_azure_terraform_driver.sh"],
    data = [
        "//deployments:scripts/azure/terraform.sh",
        "//deployments:scripts/common.sh",
    ],
)

sh_test(
    name = "test_unified_deploy",
    size = "small",
    srcs = ["test_unified_deploy.sh"],
    data = [
        "test_unified_deploy.py",
        "//deployments:scripts/lib/deploy.py",
        "//deployments:scripts/deploy-osmo-single-plane.sh",
        "//deployments:scripts/single-plane-aws.yaml",
        "//deployments:scripts/aws/terraform.sh",
        "//deployments:scripts/install-gpu-operator.sh",
        "//deployments:aws_terraform_example",
        "//deployments:scripts/common.sh",
        "//deployments/charts:osmo",
    ],
)

sh_test(
    name = "test_deploy_osmo_single_plane",
    size = "small",
    srcs = ["test_deploy_osmo_single_plane.sh"],
    data = [
        "//deployments/charts:osmo",
        "//deployments:scripts/azure/terraform.sh",
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-osmo-single-plane.sh",
        "//deployments:scripts/install-kai-scheduler.sh",
        "//deployments:scripts/single-plane-azure.yaml",
        "//deployments:scripts/single-plane-values.jq",
        "//deployments:scripts/azure/single-plane.tfvars",
        "//deployments:scripts/verify.sh",
        "//deployments:terraform/azure/example/example.tf",
        "//deployments:terraform/azure/example/outputs.tf",
        "//deployments:terraform/azure/example/workload-identity-object-storage.tf",
        "//deployments:terraform/azure/example/variables.tf",
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
        "//deployments:workflows/verify-object-storage.yaml",
    ],
)
