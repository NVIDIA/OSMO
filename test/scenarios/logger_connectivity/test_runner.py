"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Logger-connectivity scenario: end-to-end log pipeline health.
#
# - INSIDE (task.py): prints a unique log marker to stdout.
# - OUTSIDE (this file): asserts the workflow completes and the marker is
#   retrievable via the logs API (proving stdout → ctrl → logger → DB → API).

import unittest

from test.oetf.runner_fixture import RunnerFixture


class LoggerConnectivity(RunnerFixture):
    """End-to-end log pipeline scenario: stdout → ctrl → logger → DB → API."""

    timeout = "5m"

    def test_logger_connectivity(self):
        handle = self.workflow("spec.yaml").submit()
        handle.expect_outcome("completed")
        handle.assert_in_task_checks_passed(task_name="logger-probe")

        self.assertIn(
            "OETF_LOGGER_PROBE", handle.logs,
            "Log marker 'OETF_LOGGER_PROBE' not found in logs — the probe ran "
            "but its output never surfaced via the logs API. Log pipeline "
            "(ctrl → logger → DB → API) may be broken.",
        )


if __name__ == "__main__":
    unittest.main()
