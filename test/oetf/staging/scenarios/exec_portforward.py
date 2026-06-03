"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# In-task osmo exec + port-forward self-test workflows.
#
# These test the in-cluster CLI path. See also staging/scenarios/router_connectivity/
# for the external router-path counterpart.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class ExecPortforwardWorkflows(RunnerFixture):
    """In-task `osmo workflow exec` / `osmo workflow port-forward` smoke."""

    def test_exec_workflow(self):
        self.workflow("test/workflow/exec_workflow.yaml") \
            .expect_completed()

    def test_portforward_workflow(self):
        self.workflow("test/workflow/portforward_workflow.yaml") \
            .expect_completed()


if __name__ == "__main__":
    unittest.main()
