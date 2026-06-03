"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Serial workflows: tasks run in order, outputs pass between them.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class SerialWorkflows(RunnerFixture):
    """Positive + negative serial-workflow cases from validation/workflow/."""

    def test_serial_workflow(self):
        self.workflow("validation/workflow/serial_workflow.yaml") \
            .expect_completed()

    def test_serial_workflow_mounting(self):
        """Negative: mountpoint-s3 downloadType is not accepted."""
        self.workflow("validation/workflow/serial_workflow.yaml") \
            .args("download_type=mountpoint-s3") \
            .expect_failed_submission()

    # test_serial_workflow_nonroot stays internal — needs a non-root container image
    # image.

    def test_serial_workflow_update_dataset(self):
        self.workflow("validation/workflow/serial_workflow_update_dataset.yaml") \
            .expect_completed()

    # test_serial_workflow_multi_arch stays internal — needs a heterogeneous
    # pool not present in the public quick-start chart.

    def test_regex_workflow(self):
        self.workflow("validation/workflow/regex_workflow.yaml") \
            .expect_completed()


if __name__ == "__main__":
    unittest.main()
