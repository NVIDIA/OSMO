"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Smoke: osmo CLI subcommands succeed against the configured instance.

import unittest

from test_infra.oetf.smoke_fixture import SmokeFixture


class CliChecks(SmokeFixture):
    """Assert the installed osmo CLI can reach basic read APIs."""

    def test_version(self):
        # Version output is deterministic regardless of deployment state, so
        # we can loosely assert its shape without coupling to format details.
        result = self.cli("osmo version").expect_exit(0)
        self.assertRegex(
            result.stdout, r"\d+\.\d+",
            f"`osmo version` stdout lacks a version-like string: "
            f"{result.stdout[:200]!r}",
        )

    def test_workflow_list(self):
        self.cli("osmo workflow list -c 5").expect_exit(0)

    def test_pool_list(self):
        self.cli("osmo pool list").expect_exit(0)

    def test_resource_list(self):
        self.cli("osmo resource list -p default").expect_exit(0)


if __name__ == "__main__":
    unittest.main()
