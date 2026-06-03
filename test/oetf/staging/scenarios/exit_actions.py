"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Exit-action hooks, group actions, and restart-on-failure behavior.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class ExitActionsWorkflows(RunnerFixture):
    """Exit-code + group-coordination + restart semantics."""

    timeout = "5m"

    def test_exit_actions(self):
        self.workflow("test/workflow/exit_actions.yaml") \
            .expect_completed()

    def test_exit_actions_failed(self):
        """Negative: code=1 task should fail (exit action handles it)."""
        self.workflow("test/workflow/exit_actions.yaml") \
            .args("code=1") \
            .expect_failed()

    def test_group_actions(self):
        """Negative: non-lead status propagates to fail the group."""
        self.workflow("test/workflow/group_actions.yaml") \
            .args("ignore_nonlead_status=false") \
            .expect_failed()

    def test_ignore_group_actions(self):
        """Positive: non-lead failure is ignored, group passes."""
        self.workflow("test/workflow/group_actions.yaml") \
            .args("ignore_nonlead_status=true") \
            .expect_completed()

    def test_restart_reschedule(self):
        self.workflow("test/workflow/restart.yaml") \
            .timeout("10m") \
            .expect_completed()


if __name__ == "__main__":
    unittest.main()
