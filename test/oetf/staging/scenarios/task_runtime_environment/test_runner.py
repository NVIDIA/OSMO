"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Task-runtime-environment scenario: asserts the container's view of its runtime.
#
# - INSIDE (task.py): DNS, OSMO/KUBERNETES env vars, mount writability, image pin.
# - OUTSIDE (this file): asserts workflow completed + in-task checks passed.

import unittest

from test_infra.oetf.runner_fixture import RunnerFixture


class TaskRuntimeEnvironment(RunnerFixture):
    """Task-runtime-environment: DNS / env-var / mount / image probes + completion check."""

    timeout = "5m"

    def test_task_runtime_environment(self):
        handle = self.workflow("spec.yaml").submit()
        handle.expect_outcome("completed")
        handle.assert_in_task_checks_passed(task_name="check")


if __name__ == "__main__":
    unittest.main()
