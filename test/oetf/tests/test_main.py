"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
from contextlib import redirect_stdout
import io
import re
from types import SimpleNamespace
import unittest
from unittest import mock

from test.oetf import main as oetf_main


class TagSelectionTest(unittest.TestCase):
    """Environment tags must not select a different cluster's lifecycle suite."""

    @mock.patch.object(oetf_main.subprocess, "check_output", return_value="//test:chosen\n")
    def test_include_and_exclude_tags_match_complete_elements(self, query):
        # Exercise the query builder directly; no cluster is needed.
        # pylint: disable-next=protected-access
        selected = oetf_main._resolve_targets_via_query("kind,auth", "bootstrap-kind")
        self.assertEqual(selected, ["//test:chosen"])
        expression = query.call_args.args[0][2]
        quoted_patterns = re.findall(r'attr\(tags, ("(?:\\.|[^"\\])*"),', expression)
        # Bazel preserves regex backslashes inside query string literals.
        include, exclude = [re.compile(value[1:-1]) for value in quoted_patterns]
        for tags in ("[kind]", "[manual, kind]", "[kind, manual]", "[auth]"):
            self.assertIsNotNone(include.search(tags), tags)
        for tags in ("[bootstrap-kind]", "[kind-extra]", "[oauth]", "[manual]"):
            self.assertIsNone(include.search(tags), tags)
        self.assertIsNotNone(exclude.search("[manual, bootstrap-kind]"))
        self.assertIsNone(exclude.search("[kind]"))
        self.assertIsNone(exclude.search("[bootstrap-kind-extra]"))


class ResolveEnvAuthTest(unittest.TestCase):
    """Explicit token auth may use the standard token environment variable."""

    def test_token_override_reads_osmo_access_token(self):
        args = argparse.Namespace(
            auth_method="token",
            auth_token="",
            auth_username="",
            env="kind",
            local_osmo="",
            pool="",
            url="",
        )
        environment = SimpleNamespace(
            auth=SimpleNamespace(
                strategy="dev", token_env="", username="testuser",
            ),
            exclude_tags=["auth"],
            pool="default",
            url="http://quick-start.osmo",
        )

        with mock.patch.object(
            oetf_main, "resolve_environment", return_value=environment,
        ), mock.patch.dict(
            oetf_main.os.environ, {"OSMO_ACCESS_TOKEN": "managed-admin-token"},
            clear=True,
        ):
            try:
                resolved = oetf_main.resolve_env(args)
            except SystemExit as error:
                self.fail(f"explicit token auth ignored OSMO_ACCESS_TOKEN: {error}")

        self.assertEqual(resolved["auth_method"], "token")
        self.assertEqual(resolved["auth_token"], "managed-admin-token")


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
        self.assertIn("--test_env=OETF_AUTH_TOKEN", command)
        self.assertFalse(any("test-token" in argument for argument in command))

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


if __name__ == "__main__":
    unittest.main()
