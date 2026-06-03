"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for new EnvironmentAuth / EnvironmentConfig dataclasses on models.

import unittest

from test.oetf.models import EnvironmentAuth, EnvironmentConfig


class EnvironmentConfigTests(unittest.TestCase):
    """Sanity checks for the EnvironmentConfig / EnvironmentAuth dataclasses."""

    def test_custom_env_defaults(self):
        env = EnvironmentConfig(
            name="staging",
            url="https://s.example",
            auth=EnvironmentAuth(strategy="token", token_env="X"),
            type="custom",
        )
        self.assertFalse(env.allow_deploy)
        self.assertEqual(env.mode, "cpu")
        self.assertEqual(env.cluster_name, "")
        self.assertEqual(env.dev_user, "")
        self.assertEqual(env.exclude_tags, [])

    def test_kind_env_fields(self):
        env = EnvironmentConfig(
            name="kind",
            url="http://quick-start.osmo",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
            type="kind",
            allow_deploy=True,
            cluster_name="osmo",
            mode="cpu",
        )
        self.assertEqual(env.cluster_name, "osmo")
        self.assertEqual(env.auth.username, "testuser")


if __name__ == "__main__":
    unittest.main()
