"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

load("@osmo_workspace//bzl:py.bzl", "osmo_py_test")
load("@osmo_python_deps//:requirements.bzl", "requirement")

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
        "check-head-chart-contract.sh",
        "//deployments:scripts/single-plane-azure.yaml",
        "//deployments:scripts/single-plane-values.jq",
        "//deployments/charts:osmo",
    ],
)

sh_test(
    name = "test_azure_state",
    srcs = ["tests/test_azure_state.sh"],
    size = "small",
    data = ["azure-state.sh"],
)

sh_test(
    name = "test_azure_cleanup",
    srcs = ["tests/test_azure_cleanup.sh"],
    size = "small",
    data = [
        "azure-cleanup.sh",
        "azure-inputs.sh",
        "//deployments:scripts/azure/single-plane.tfvars",
        "//deployments:terraform/azure/example/example.tf",
        "//deployments:terraform/azure/example/variables.tf",
        "//deployments:terraform/azure/example/outputs.tf",
        "//deployments:terraform/azure/example/workload-identity-object-storage.tf",
    ],
)

sh_test(
    name = "test_single_plane_oetf",
    srcs = ["tests/test_single_plane_oetf.sh"],
    size = "small",
    data = ["azure-inputs.sh", "oetf-single-plane.yaml", "run-single-plane-oetf.sh"],
)

osmo_py_test(
    name = "test_workflow_contract",
    srcs = ["tests/test_workflow_contract.py"],
    data = [
        "oetf-single-plane.yaml",
        "//.github/workflows:deployment-test.yaml",
        "//test/oetf:data/oetf.default.yaml",
    ],
    deps = [
        "//test/oetf:environments",
        "//test/oetf:run_lib",
        requirement("pyyaml"),
    ],
)
