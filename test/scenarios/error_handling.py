"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Failure-path coverage: exec timeout, start error, byte-spec resources, CLI workflow.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class ErrorHandlingWorkflows(RunnerFixture):
    """Assorted error-condition tests that don't fit other categories."""

    def test_exec_timeout(self):
        """Expect a server-side exec_timeout termination."""
        self.workflow("test/workflow/exec_timeout.yaml") \
            .expect_timeout()

    # test_catch_start_error stays internal — needs an internal-only OCI registry/start_error
    # image which isn't shipped publicly.

    def test_resource_as_byte(self):
        """Positive: byte-spec resource values (e.g. cpu: 1024Mi) parse + run."""
        self.workflow("test/workflow/resource_type.yaml") \
            .timeout("1m") \
            .expect_completed()

    def test_osmo_client_test(self):
        """In-task workflow that exercises the osmo CLI from inside the container."""
        self.workflow("test/workflow/osmo_client_test.yaml") \
            .expect_completed()


if __name__ == "__main__":
    unittest.main()
