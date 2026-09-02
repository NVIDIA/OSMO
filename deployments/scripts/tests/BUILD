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
    name = "test_helm_render_path",
    srcs = ["test_helm_render_path.sh"],
    size = "small",
    data = [
        "//ci/deployment-test:azure-overrides.yaml",
        "//ci/deployment-test:fixtures/minio-storage-values.yaml",
        "//deployments:scripts/common.sh",
        "//deployments:scripts/deploy-k8s.sh",
        "//deployments:values/backend-operator.yaml",
        "//deployments:values/service.yaml",
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
        "//deployments:scripts/single-plane-azure.tfvars",
        "//deployments:scripts/single-plane-azure.yaml",
        "//deployments:scripts/verify.sh",
        "//deployments:terraform/azure/example/example.tf",
        "//deployments:terraform/azure/example/outputs.tf",
        "//deployments:terraform/azure/example/single-plane-object-storage.tf",
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
