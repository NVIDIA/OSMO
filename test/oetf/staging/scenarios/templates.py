"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Template-evaluation safety checks (Jinja sandbox + resource guards).

import unittest

from test.oetf.runner_fixture import RunnerFixture


class TemplateValidation(RunnerFixture):
    """Malicious or runaway templates must be caught at submit."""

    timeout = "1m"

    def test_template_unsafe(self):
        """Sandbox violation (e.g. __class__ access) — rejected at submit."""
        self.workflow("test/workflow/template_unsafe.yaml") \
            .expect_failed_submission()

    def test_template_too_much_cpu(self):
        """Jinja substitution timeout — rejected at submit."""
        self.workflow("test/workflow/template_too_much_cpu.yaml") \
            .expect_failed_submission()

    def test_template_too_much_memory(self):
        """Jinja substitution timeout — rejected at submit."""
        self.workflow("test/workflow/template_too_much_memory.yaml") \
            .expect_failed_submission()


if __name__ == "__main__":
    unittest.main()
