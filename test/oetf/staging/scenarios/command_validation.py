"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Command / container-command validation at submit time.

import unittest

from test_infra.oetf.runner_fixture import RunnerFixture


class CommandValidation(RunnerFixture):
    """Empty or malformed container commands must fail at submission."""

    timeout = "1m"

    def test_empty_command(self):
        self.workflow("validation/workflow/empty_command.yaml").expect_failed_submission()

    def test_bad_command(self):
        self.workflow("validation/workflow/bad_command.yaml").expect_failed_submission()


if __name__ == "__main__":
    unittest.main()
