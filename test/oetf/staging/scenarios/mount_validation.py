"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Volume-mount validation at submit time.

import unittest

from test_infra.oetf.runner_fixture import RunnerFixture


class MountValidation(RunnerFixture):
    """Invalid volume mounts must be rejected at submission."""

    timeout = "1m"

    def test_invalid_host_mount(self):
        self.workflow("validation/workflow/invalid_mount.yaml").expect_failed_submission()

    def test_invalid_src_dest_mount(self):
        self.workflow("validation/workflow/invalid_src_dest_mount.yaml") \
            .expect_failed_submission()


if __name__ == "__main__":
    unittest.main()
