"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
from contextlib import redirect_stderr, redirect_stdout
import io
from types import SimpleNamespace
import unittest
from unittest import mock

from test.oetf import main as oetf_main
from test.oetf.models import EnvironmentAuth, EnvironmentConfig


class MainResultContractTest(unittest.TestCase):
    """The OETF wrapper fails closed when Bazel does not run its tests."""

    @staticmethod
    def _result(status: str = "pass") -> dict:
        return {
            "target": "//test:target",
            "classname": "",
            "name": "target",
            "time": 0.1,
            "status": status,
            "message": "",
        }

    @staticmethod
    def _run_main(
        bazel_exit: int,
        results: list[dict],
    ) -> tuple[int, str]:
        args = argparse.Namespace(
            env="staging",
            name="profile-round-trip",
            output_json="",
            tags="",
        )
        env = {
            "auth_token": "test-token",
            "url": "https://staging.example",
        }
        stdout = io.StringIO()
        with mock.patch.object(oetf_main, "parse_args", return_value=args), \
             mock.patch.object(oetf_main, "resolve_env", return_value=env), \
             mock.patch.object(oetf_main, "seed_data_credential"), \
             mock.patch.object(oetf_main, "_bep_path", return_value="/tmp/bep.json"), \
             mock.patch.object(
                 oetf_main,
                 "build_bazel_command",
                 return_value=["bazel", "test", "//test:target"],
             ), \
             mock.patch.object(
                 oetf_main.subprocess,
                 "run",
                 return_value=SimpleNamespace(returncode=bazel_exit),
             ), \
             mock.patch.object(
                 oetf_main,
                 "parse_bep_test_results",
                 return_value=results,
             ), \
             mock.patch.object(oetf_main, "maybe_publish_report"), \
             redirect_stdout(stdout):
            exit_code = oetf_main.main([])
        return exit_code, stdout.getvalue()

    def test_analysis_failure_with_no_results_reports_fail(self):
        exit_code, output = self._run_main(1, [])

        self.assertEqual(exit_code, 1)
        self.assertIn("Bazel exit code: 1", output)
        self.assertIn("(no test results reported by Bazel)", output)
        self.assertIn("RESULT: FAIL", output)
        self.assertNotIn("RESULT: PASS", output)

    def test_zero_results_fail_closed_when_bazel_exits_zero(self):
        exit_code, output = self._run_main(0, [])

        self.assertEqual(exit_code, 1)
        self.assertIn("RESULT: FAIL", output)

    def test_nonzero_bazel_exit_overrides_passing_test_result(self):
        exit_code, output = self._run_main(1, [self._result()])

        self.assertEqual(exit_code, 1)
        self.assertIn("Bazel exit code: 1", output)
        self.assertIn("RESULT: FAIL", output)

    def test_failed_or_errored_result_reports_fail(self):
        for status in ("fail", "error"):
            with self.subTest(status=status):
                exit_code, output = self._run_main(
                    0,
                    [self._result(status)],
                )

                self.assertEqual(exit_code, 1)
                self.assertIn("RESULT: FAIL", output)
                self.assertNotIn("RESULT: PASS", output)

    def test_successful_bazel_run_with_passing_result_reports_pass(self):
        exit_code, output = self._run_main(0, [self._result()])

        self.assertEqual(exit_code, 0)
        self.assertIn("RESULT: PASS", output)


class ResolveMcpSessionDirectoryTest(unittest.TestCase):
    """The runner forwards only an explicit local directory, before sandboxing."""

    @staticmethod
    def _resolve(*flags: str) -> dict[str, str]:
        args = oetf_main.parse_args(["--env", "test", *flags])
        environment = EnvironmentConfig(
            name="test", url="https://example.com", pool="test-pool",
            auth=EnvironmentAuth(strategy="dev", username="api-caller"),
        )
        with mock.patch.object(oetf_main, "resolve_environment", return_value=environment):
            return oetf_main.resolve_env(args)

    def test_inherits_and_normalizes_environment_path(self):
        with mock.patch.dict(oetf_main.os.environ, {
            "OETF_MCP_SESSION_DIR": "private/mcp session",
        }, clear=True):
            result = self._resolve()
        self.assertEqual(
            result["mcp_session_dir"],
            str(oetf_main.Path("private/mcp session").absolute()),
        )

    def test_flag_overrides_environment_path(self):
        with mock.patch.dict(oetf_main.os.environ, {
            "OETF_MCP_SESSION_DIR": "/private/ignored",
        }, clear=True):
            result = self._resolve("--mcp-session-dir", "/private/selected")
        self.assertEqual(result["mcp_session_dir"], "/private/selected")

    def test_non_mcp_runs_do_not_require_a_session(self):
        with mock.patch.dict(oetf_main.os.environ, {}, clear=True):
            self.assertEqual(self._resolve()["mcp_session_dir"], "")

    def test_invalid_paths_fail_without_echoing_input(self):
        for invalid in ("https://secret.invalid/token", "private\nsecret", "private\x00secret"):
            with self.subTest(path_kind=repr(invalid[:7])), \
                    redirect_stderr(io.StringIO()) as errors:
                with self.assertRaises(SystemExit) as raised:
                    self._resolve("--mcp-session-dir", invalid)
                self.assertEqual(raised.exception.code, 2)
                self.assertNotIn(invalid, errors.getvalue())


class BuildBazelCommandTest(unittest.TestCase):
    """Environment-specific host resources are passed into Bazel tests."""

    @staticmethod
    def _args(env: str) -> argparse.Namespace:
        return argparse.Namespace(
            bazel_arg=[],
            env=env,
            jobs=1,
            name="",
            tags="",
            target_pattern=[],
        )

    @staticmethod
    def _env() -> dict[str, str]:
        return {
            "auth_method": "token",
            "auth_token": "test-token",
            "auth_username": "test-user",
            "exclude_tags": "",
            "local_osmo": "",
            "pool": "default",
            "url": "https://kind.example",
        }

    def test_discovery_and_test_share_only_module_overrides(self):
        candidate = "osmo_workspace=/public candidate"
        target = "@osmo_workspace//test/smoke:mcp-checks"
        for overrides in ([f"--override_module={candidate}"], ["--override_module", candidate]):
            with self.subTest(overrides=overrides):
                args = self._args("staging")
                args.target_pattern = [target]
                args.bazel_arg = [
                    "--test_arg=McpChecks.test_public_discovery_surface", *overrides,
                    "--test_output=all", "--override_module=other=/other candidate",
                ]
                with mock.patch.object(oetf_main.subprocess, "check_output",
                                       return_value=target + "\n") as query:
                    command = oetf_main.build_bazel_command(args, self._env(), "/tmp/bep.json")
                query.assert_called_once()
                query_command = query.call_args.args[0]
                self.assertEqual(query_command[:2], ["bazel", "query"])
                self.assertIn(target, query_command[2])
                self.assertEqual(query_command[3:], [
                    "--output=label", *overrides, "--override_module=other=/other candidate",
                ])
                self.assertIn(target, command)
                self.assertEqual(command[-len(args.bazel_arg):], args.bazel_arg)

    def test_named_target_and_test_share_only_module_overrides(self):
        candidate = "osmo_workspace=/public candidate"
        target = "//test/smoke:probe"
        for overrides in ([f"--override_module={candidate}"], ["--override_module", candidate]):
            with self.subTest(overrides=overrides):
                args = self._args("staging")
                args.name = "CandidateChecks.test_probe"
                args.bazel_arg = ["--test_output=all", *overrides]
                with (
                    mock.patch.object(oetf_main, "_workspace_root", return_value="/internal"),
                    mock.patch.object(oetf_main.Path, "is_dir", return_value=True),
                    mock.patch.object(oetf_main.Path, "rglob", return_value=[
                        oetf_main.Path("/internal/test/smoke/probe.py"),
                    ]),
                    mock.patch.object(oetf_main.Path, "read_text", return_value=(
                        "class CandidateChecks(unittest.TestCase):\n"
                        "    def test_probe(self): pass\n"
                    )),
                    mock.patch.object(oetf_main.subprocess, "run", return_value=SimpleNamespace(
                        returncode=0, stdout=target + "\n",
                    )) as query,
                ):
                    command = oetf_main.build_bazel_command(args, self._env(), "/tmp/bep.json")
                query.assert_called_once_with(
                    ["bazel", "query", target, "--output=label", *overrides],
                    cwd="/internal", capture_output=True, text=True, check=False,
                )
                self.assertIn(target, command)
                self.assertEqual(command[-len(args.bazel_arg):], args.bazel_arg)

    def test_missing_module_override_value_fails_before_query(self):
        for arguments in (["--override_module"], ["--override_module", "--test_output=all"]):
            with self.subTest(arguments=arguments):
                args = self._args("staging")
                args.bazel_arg = arguments
                with mock.patch.object(oetf_main.subprocess, "check_output") as query:
                    with self.assertRaisesRegex(SystemExit, "requires a module=path value"):
                        oetf_main.build_bazel_command(args, self._env(), "/tmp/bep.json")
                query.assert_not_called()

    @mock.patch.object(
        oetf_main,
        "_resolve_targets_via_query",
        return_value=["//test/smoke:mek-rotation-kind"],
    )
    def test_kind_passes_explicit_kubeconfig_into_bazel(self, resolve_mock):
        self.assertIsNotNone(resolve_mock)
        with mock.patch.dict(
            oetf_main.os.environ,
            {"KUBECONFIG": "/runner/kind-kubeconfig"},
            clear=True,
        ):
            command = oetf_main.build_bazel_command(
                self._args("kind"), self._env(), "/tmp/bep.json",
            )

        self.assertIn(
            "--test_env=KUBECONFIG=/runner/kind-kubeconfig",
            command,
        )

    @mock.patch.object(
        oetf_main,
        "_resolve_targets_via_query",
        return_value=["//test/smoke:mek-rotation-kind"],
    )
    def test_kind_passes_installed_quick_start_chart_into_bazel(self, resolve_mock):
        self.assertIsNotNone(resolve_mock)
        with mock.patch.dict(
            oetf_main.os.environ,
            {"OETF_HELM_CHART_PATH": "/tmp/installed-quick-start"},
            clear=True,
        ):
            command = oetf_main.build_bazel_command(
                self._args("kind"), self._env(), "/tmp/bep.json",
            )

        self.assertIn(
            "--test_env=OETF_HELM_CHART_PATH=/tmp/installed-quick-start",
            command,
        )

    @mock.patch.object(
        oetf_main,
        "_resolve_targets_via_query",
        return_value=["//test/smoke:mek-rotation-kind"],
    )
    def test_kind_passes_default_home_kubeconfig_into_bazel(self, resolve_mock):
        self.assertIsNotNone(resolve_mock)
        with mock.patch.dict(oetf_main.os.environ, {}, clear=True), \
             mock.patch.object(
                 oetf_main.Path,
                 "home",
                 return_value=oetf_main.Path("/runner"),
             ):
            command = oetf_main.build_bazel_command(
                self._args("kind"), self._env(), "/tmp/bep.json",
            )

        self.assertIn(
            "--test_env=KUBECONFIG=/runner/.kube/config",
            command,
        )

    @mock.patch.object(
        oetf_main,
        "_resolve_targets_via_query",
        return_value=["//test/smoke:profile-round-trip"],
    )
    def test_non_kind_does_not_pass_kubeconfig(self, resolve_mock):
        self.assertIsNotNone(resolve_mock)
        with mock.patch.dict(
            oetf_main.os.environ,
            {
                "KUBECONFIG": "/runner/unrelated-kubeconfig",
                "OETF_HELM_CHART_PATH": "/tmp/unrelated-quick-start",
            },
            clear=True,
        ):
            command = oetf_main.build_bazel_command(
                self._args("staging"), self._env(), "/tmp/bep.json",
            )

        self.assertFalse(any(
            argument.startswith("--test_env=KUBECONFIG=")
            for argument in command
        ))
        self.assertFalse(any(
            argument.startswith("--test_env=OETF_HELM_CHART_PATH=")
            for argument in command
        ))

    @mock.patch.object(
        oetf_main, "_resolve_targets_via_query",
        return_value=["//test/smoke:mcp-checks"],
    )
    def test_mcp_session_path_is_forwarded_without_inline_tokens(self, resolve_mock):
        self.assertIsNotNone(resolve_mock)
        environment = self._env()
        environment["mcp_session_dir"] = "/private/mcp session"
        with mock.patch.dict(oetf_main.os.environ, {
            "OSMO_MCP_ACCESS_TOKEN": "obsolete-inline-token",
        }, clear=True):
            command = oetf_main.build_bazel_command(
                self._args("staging"), environment, "/tmp/bep.json",
            )
        self.assertIn("--test_env=OETF_MCP_SESSION_DIR=/private/mcp session", command)
        self.assertNotIn("obsolete-inline-token", " ".join(command))
        self.assertFalse(any("OSMO_MCP_ACCESS_TOKEN" in argument for argument in command))


if __name__ == "__main__":
    unittest.main()
