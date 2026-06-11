"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for oetf.models — just the types the Bazel-native framework uses.

import os
import unittest
from unittest import mock

from test.oetf.models import OetfConfig, WorkflowServerStatus


class TestWorkflowServerStatus(unittest.TestCase):
    """The `terminal` property drives WorkflowHandle.wait_for_terminal."""

    def test_terminal_statuses(self):
        self.assertTrue(WorkflowServerStatus.COMPLETED.terminal)
        self.assertTrue(WorkflowServerStatus.FAILED.terminal)
        self.assertTrue(WorkflowServerStatus.FAILED_EXEC_TIMEOUT.terminal)
        self.assertTrue(WorkflowServerStatus.FAILED_CANCELED.terminal)
        self.assertTrue(WorkflowServerStatus.FAILED_IMAGE_PULL.terminal)

    def test_non_terminal_statuses(self):
        self.assertFalse(WorkflowServerStatus.PENDING.terminal)
        self.assertFalse(WorkflowServerStatus.RUNNING.terminal)
        self.assertFalse(WorkflowServerStatus.WAITING.terminal)


class TestOetfConfigFromEnv(unittest.TestCase):
    """OetfConfig.from_env is the config source for every OETF test fixture."""

    def test_reads_oetf_url_and_token(self):
        with mock.patch.dict(os.environ, {
            "OETF_URL": "https://example.com",
            "OETF_AUTH_TOKEN": "t0k3n",
            "OETF_POOL": "my-pool",
            "OETF_CLIENT": "cli",
        }, clear=False):
            config = OetfConfig.from_env()
        self.assertEqual(config.url, "https://example.com")
        self.assertEqual(config.auth_token, "t0k3n")
        self.assertEqual(config.pool, "my-pool")
        self.assertEqual(config.client, "cli")

    def test_falls_back_to_osmo_access_token(self):
        env = {"OETF_URL": "https://example.com", "OSMO_ACCESS_TOKEN": "legacy"}
        # OETF_AUTH_TOKEN not set → .get() returns the fallback-env lookup.
        with mock.patch.dict(os.environ, env, clear=True):
            config = OetfConfig.from_env()
        self.assertEqual(config.auth_token, "legacy")

    def test_default_pool_and_client(self):
        with mock.patch.dict(os.environ, {"OETF_URL": "https://example.com"}, clear=True):
            config = OetfConfig.from_env()
        self.assertEqual(config.pool, "default")
        self.assertEqual(config.client, "api")
        self.assertEqual(config.auth_method, "token")


if __name__ == "__main__":
    unittest.main()
