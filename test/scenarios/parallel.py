"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Parallel-task workflows and templated file submissions.

import unittest

from test.oetf.runner_fixture import RunnerFixture


class ParallelWorkflows(RunnerFixture):
    """Parallel task execution + templated-files patterns."""

    def test_parallel_workflow_v2(self):
        self.workflow("test/workflow/parallel_workflow_v2.yaml") \
            .expect_completed()

    def test_serial_workflow_templated_with_files(self):
        self.workflow("test/workflow/serial_workflow_mount.yaml") \
            .expect_completed()

    def test_parallel_workflow_templated_with_files_v2(self):
        self.workflow("test/workflow/parallel_workflow_mount_v2.yaml") \
            .expect_completed()

    def test_parallel_workflow_multi_groups(self):
        self.workflow("test/workflow/parallel_workflow_multi_groups.yaml") \
            .expect_completed()

    def test_parallel_workflow_leader_exits(self):
        """Negative: leader task exits, group should fail."""
        self.workflow("test/workflow/parallel_workflow_leader_exits.yaml") \
            .expect_failed()


if __name__ == "__main__":
    unittest.main()
