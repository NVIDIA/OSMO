"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Datasets, apps, checkpointing, and storage-provider workflows.

import unittest

from test_infra.oetf.runner_fixture import RunnerFixture


class DataStorageWorkflows(RunnerFixture):
    """End-to-end dataset / app / checkpoint flows on live data."""

    # test_data_storage_provider stays internal — needs an internal gitlab
    # clone + an internal-only OCI registry image.

    def test_dataset_cli(self):
        self.workflow("validation/workflow/dataset_cli.yaml") \
            .expect_completed()

    def test_workflow_cli(self):
        self.workflow("validation/workflow/workflow_cli.yaml") \
            .expect_completed()

    def test_app_cli(self):
        self.workflow("validation/workflow/app_cli.yaml") \
            .args("app_name=oetf-integration-test-app") \
            .expect_completed()

    # test_checkpoint_data stays internal — an internal object-storage backend-specific code path.


if __name__ == "__main__":
    unittest.main()
