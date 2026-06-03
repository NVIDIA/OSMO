"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Submission-time resource-validation negative cases.
#
# All four assert the server rejects out-of-bounds resource requests at submit
# time, without ever scheduling the workflow.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class ResourceValidation(RunnerFixture):
    """Over-sized or invalid resource requests must fail at submission."""

    timeout = "1m"

    def test_cpu_too_high_v2(self):
        self.workflow("test/workflow/bad_resource_workflow_v2.yaml") \
            .args("cpu=1000000") \
            .expect_failed_submission()

    def test_storage_too_high_v2(self):
        self.workflow("test/workflow/bad_resource_workflow_v2.yaml") \
            .args("storage=1000000Gi") \
            .expect_failed_submission()

    def test_memory_too_high_v2(self):
        self.workflow("test/workflow/bad_resource_workflow_v2.yaml") \
            .args("memory=1000000Gi") \
            .expect_failed_submission()

    def test_bad_platform_v2(self):
        self.workflow("test/workflow/bad_resource_workflow_v2.yaml") \
            .args("platform=bad-platform") \
            .expect_failed_submission()


if __name__ == "__main__":
    unittest.main()
