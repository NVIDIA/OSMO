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
            url="http://127.0.0.1",
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
        ) as run_mock, mock.patch.object(
            deploy_and_run_main, "create_service_client",
        ) as create_client:
            create_client.return_value.request.return_value = {"resources": [{"name": "node"}]}
            result = deploy_and_run_main._run_tests(  # pylint: disable=protected-access
                args, environment,
            )

        self.assertEqual(result, 0)
        kubectl_command = run_mock.call_args_list[0].args[0]
        self.assertEqual(kubectl_command[:4], [
            "kubectl", "--context", "kind-osmo", "get",
        ])
        test_command = run_mock.call_args_list[1].args[0]
        self.assertIn("--auth-method", test_command)
        self.assertIn("token", test_command)
        self.assertEqual(
            test_command[test_command.index("--url") + 1], "http://127.0.0.1",
        )
        self.assertFalse(any("-mcp" in part for part in test_command))
        self.assertFalse(any("managed-admin-token" in part for part in test_command))
        self.assertEqual(
            run_mock.call_args_list[1].kwargs["env"]["OSMO_ACCESS_TOKEN"],
            "managed-admin-token",
        )

    def test_released_kind_excludes_mcp_and_preserves_caller_tag_filters(self):
        args = argparse.Namespace(
            build_local=False,
            cluster_name="",
            env="kind",
            verbose=False,
            bazel_arg=["--test_tag_filters=-database"],
        )
        environment = EnvironmentConfig(
            name="kind",
            url="http://quick-start.osmo",
            auth=EnvironmentAuth(strategy="dev", username="testuser"),
            type="kind",
            pool="default",
        )

        with mock.patch.object(
            deploy_and_run_main.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0),
        ) as run_mock:
            result = deploy_and_run_main._run_tests(  # pylint: disable=protected-access
                args, environment,
            )

        self.assertEqual(result, 0)
        run_mock.assert_called_once()
        command = run_mock.call_args.args[0]
        self.assertIn("--bazel-arg=--test_tag_filters=-database,-mcp", command)
        self.assertEqual(command[command.index("--auth-method") + 1], "dev")
        self.assertEqual(
            command[command.index("--url") + 1], "http://quick-start.osmo",
        )


class PoolReadinessTest(unittest.TestCase):
    """Do not launch source-built KIND tests before node inventory arrives."""
    # pylint: disable=protected-access

    def setUp(self):
        self.args = deploy_and_run_main.parse_arguments(["--env", "kind", "--build-local"])
        self.environment = EnvironmentConfig(
            name="kind", url="http://127.0.0.1", type="kind", pool="default",
            auth=EnvironmentAuth(strategy="token"),
        )
        self.run_mock = self.enterContext(mock.patch.object(
            deploy_and_run_main.subprocess, "run",
            side_effect=[
                SimpleNamespace(returncode=0, stdout="managed-admin-token", stderr=""),
                SimpleNamespace(returncode=0),
            ],
        ))
        self.create_client = self.enterContext(mock.patch.object(
            deploy_and_run_main, "create_service_client",
        ))
        self.request = self.create_client.return_value.request
        self.request.return_value = {"resources": [{"name": "node"}]}
        self.sleep = self.enterContext(mock.patch.object(deploy_and_run_main.time, "sleep"))
        self.monotonic = self.enterContext(mock.patch.object(
            deploy_and_run_main.time, "monotonic", return_value=0,
        ))

    def test_waits_for_resources_before_launch_and_honors_pool_override(self):
        self.args.pool = "selected-pool"
        self.request.side_effect = [{"resources": []}, {"resources": [{"name": "node"}]}]

        def run(command, **_kwargs):
            if command[0] == "kubectl":
                return SimpleNamespace(returncode=0, stdout="managed-admin-token", stderr="")
            self.assertEqual(self.request.call_count, 2, "Tests launched before pool readiness")
            return SimpleNamespace(returncode=0)

        self.run_mock.side_effect = run
        with self.assertLogs(deploy_and_run_main.logger, level="DEBUG") as logs:
            result = deploy_and_run_main._run_tests(self.args, self.environment)

        self.assertEqual(result, 0)
        self.sleep.assert_called_once_with(2)
        self.assertEqual(self.request.call_args.kwargs, {
            "method": deploy_and_run_main.RequestMethod.GET,
            "endpoint": "api/resources",
            "params": {"pools": ["selected-pool"]},
            "version_header": False,
        })
        config = self.create_client.call_args.args[0]
        self.assertEqual(config.url, self.environment.url)
        self.assertEqual(config.auth_method, "token")
        self.assertEqual(config.auth_token, "managed-admin-token")
        self.assertNotIn("managed-admin-token", " ".join(logs.output))

    def test_timeout_blocks_test_subprocess(self):
        self.request.return_value = {"resources": []}
        self.monotonic.side_effect = [0, 0, 180]
        with self.assertLogs(deploy_and_run_main.logger, level="ERROR") as logs:
            result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, deploy_and_run_main.EXIT_FRAMEWORK_ERROR)
        self.run_mock.assert_called_once()
        self.assertIn("default reported no resources within 180 seconds", " ".join(logs.output))

    def test_auth_failure_blocks_tests_without_leaking_token(self):
        self.create_client.side_effect = ValueError("invalid managed-admin-token")
        with self.assertLogs(deploy_and_run_main.logger, level="ERROR") as logs:
            result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, deploy_and_run_main.EXIT_FRAMEWORK_ERROR)
        self.run_mock.assert_called_once()
        self.request.assert_not_called()
        self.assertIn("ValueError", " ".join(logs.output))
        self.assertNotIn("managed-admin-token", " ".join(logs.output))

    def test_malformed_response_blocks_tests(self):
        self.request.return_value = {"resources": "managed-admin-token"}
        with self.assertLogs(deploy_and_run_main.logger, level="ERROR") as logs:
            result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, deploy_and_run_main.EXIT_FRAMEWORK_ERROR)
        self.run_mock.assert_called_once()
        self.sleep.assert_not_called()
        self.assertNotIn("managed-admin-token", " ".join(logs.output))

    def test_resource_request_error_blocks_tests_without_retrying(self):
        self.request.side_effect = deploy_and_run_main.osmo_errors.OSMOError(
            "request failed for managed-admin-token",
        )
        with self.assertLogs(deploy_and_run_main.logger, level="ERROR") as logs:
            result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, deploy_and_run_main.EXIT_FRAMEWORK_ERROR)
        self.run_mock.assert_called_once()
        self.request.assert_called_once()
        self.sleep.assert_not_called()
        self.assertNotIn("managed-admin-token", " ".join(logs.output))

    def test_missing_pool_blocks_tests(self):
        self.environment.pool = ""
        with self.assertLogs(deploy_and_run_main.logger, level="ERROR"):
            result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, deploy_and_run_main.EXIT_FRAMEWORK_ERROR)
        self.run_mock.assert_called_once()
        self.create_client.assert_not_called()

    def test_readiness_uses_explicit_token_override(self):
        self.args.auth_token = "caller-token"
        result = deploy_and_run_main._run_tests(self.args, self.environment)
        self.assertEqual(result, 0)
        self.assertEqual(self.create_client.call_args.args[0].auth_token, "caller-token")


if __name__ == "__main__":
    unittest.main()
