"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
from types import SimpleNamespace
import unittest
from unittest import mock

from test.oetf import deploy_and_run_main
from test.oetf.models import EnvironmentAuth, EnvironmentConfig


class RunTestsAuthTest(unittest.TestCase):
    """Local unified-chart tests use the chart-managed administrator token."""

    def test_build_local_kind_uses_managed_admin_token_without_argv_leak(self):
        args = argparse.Namespace(
            build_local=True,
            cluster_name="",
            env="kind",
            verbose=False,
        )
        environment = EnvironmentConfig(
            name="kind",
            url="http://quick-start.osmo",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
            type="kind",
            pool="default",
        )
        kubectl_result = SimpleNamespace(
            returncode=0,
            stdout="managed-admin-token",
            stderr="",
        )
        test_result = SimpleNamespace(returncode=0)

        with mock.patch.object(
            deploy_and_run_main.subprocess,
            "run",
            side_effect=[kubectl_result, test_result],
        ) as run_mock:
            result = deploy_and_run_main._run_tests(args, environment)

        self.assertEqual(result, 0)
        kubectl_command = run_mock.call_args_list[0].args[0]
        self.assertEqual(kubectl_command[:4], [
            "kubectl", "--context", "kind-osmo", "get",
        ])
        test_command = run_mock.call_args_list[1].args[0]
        self.assertIn("--auth-method", test_command)
        self.assertIn("token", test_command)
        self.assertFalse(any("managed-admin-token" in part for part in test_command))
        self.assertEqual(
            run_mock.call_args_list[1].kwargs["env"]["OSMO_ACCESS_TOKEN"],
            "managed-admin-token",
        )


if __name__ == "__main__":
    unittest.main()
