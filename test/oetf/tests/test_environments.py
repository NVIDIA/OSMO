"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Unit tests for oetf.environments and oetf.preflight.

import os
import tempfile
import unittest

from unittest import mock

from test_infra.oetf import environments
from test_infra.oetf.environments import (
    default_environment_paths,
    load_environments,
    resolve_environment,
    resolve_token,
)
from test_infra.oetf.preflight import (
    PreflightError,
    check_auth,
    check_auth_config,
    collect_errors,
)


CANONICAL_YAML = """
version: "1"
environments:
  staging:
    url: https://staging.example/
    auth:
      strategy: token
      token_env: OETF_TOKEN
    type: custom
    pool: default
  kind:
    url: http://quick-start.osmo
    auth:
      strategy: dev
      username: testuser
    type: kind
    allow_deploy: true
    cluster_name: osmo
    mode: cpu
"""


OVERLAY_YAML = """
version: "1"
environments:
  my-dev:
    url: https://dev.example
    auth:
      strategy: token
      token_env: OSMO_DEV_TOKEN
    type: dev
    allow_deploy: true
    dev_user: testuser
    pool: cpu-pool
  staging:                            # override canonical
    url: https://staging-alt.example
    auth:
      strategy: token
      token_env: ALT_TOKEN
    type: custom
"""


def _write(tmpdir: str, name: str, content: str) -> str:
    path = os.path.join(tmpdir, name)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)
    return path


class TestLoadEnvironments(unittest.TestCase):
    """Parsing and merge behavior of environments.yaml."""

    def test_load_canonical_only(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            envs = load_environments([path])
            self.assertEqual(set(envs), {"staging", "kind"})
            # trailing / stripped
            self.assertEqual(envs["staging"].url, "https://staging.example")
            self.assertEqual(envs["staging"].auth.strategy, "token")
            self.assertEqual(envs["staging"].auth.token_env, "OETF_TOKEN")
            self.assertEqual(envs["staging"].pool, "default")
            self.assertEqual(envs["kind"].auth.strategy, "dev")
            self.assertEqual(envs["kind"].auth.username, "testuser")
            self.assertEqual(envs["kind"].type, "kind")
            self.assertTrue(envs["kind"].allow_deploy)
            self.assertEqual(envs["kind"].cluster_name, "osmo")
            self.assertEqual(envs["kind"].mode, "cpu")
            self.assertEqual(envs["staging"].type, "custom")
            self.assertFalse(envs["staging"].allow_deploy)

    def test_overlay_wins_on_conflict(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            overlay = _write(tmpdir, "overlay.yaml", OVERLAY_YAML)
            envs = load_environments([canonical, overlay])
            self.assertEqual(set(envs), {"staging", "kind", "my-dev"})
            # overlay's staging wins
            self.assertEqual(envs["staging"].url, "https://staging-alt.example")
            self.assertEqual(envs["staging"].auth.token_env, "ALT_TOKEN")
            # canonical kind still there
            self.assertEqual(envs["kind"].auth.username, "testuser")
            # overlay-only my-dev loaded
            self.assertEqual(envs["my-dev"].type, "dev")
            self.assertTrue(envs["my-dev"].allow_deploy)
            self.assertEqual(envs["my-dev"].dev_user, "testuser")

    def test_missing_file_silently_skipped(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            envs = load_environments([canonical, "/nonexistent/does-not-exist.yaml"])
            self.assertIn("staging", envs)

    def test_missing_url_raises(self):
        bad = """
version: "1"
environments:
  broken:
    auth: {strategy: token, token_env: X}
    type: custom
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "missing required 'url'"):
                load_environments([path])

    def test_missing_type_raises(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: token, token_env: X}
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "'type' must be"):
                load_environments([path])

    def test_kind_without_cluster_name_raises(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: dev, username: u}
    type: kind
    allow_deploy: true
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "type=kind requires 'cluster_name'"):
                load_environments([path])

    def test_dev_without_dev_user_raises(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: token, token_env: X}
    type: dev
    allow_deploy: true
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "type=dev requires 'dev_user'"):
                load_environments([path])

    def test_custom_env_forces_allow_deploy_false(self):
        yaml_content = """
version: "1"
environments:
  sneaky:
    url: http://example
    auth: {strategy: token, token_env: X}
    type: custom
    allow_deploy: true         # YAML says true but custom always pins to false
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "c.yaml", yaml_content)
            envs = load_environments([path])
            self.assertFalse(envs["sneaky"].allow_deploy)

    def test_allow_deploy_defaults_false(self):
        yaml_content = """
version: "1"
environments:
  kshared:
    url: http://example
    auth: {strategy: dev, username: u}
    type: kind
    cluster_name: osmo
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "c.yaml", yaml_content)
            envs = load_environments([path])
            self.assertEqual(envs["kshared"].type, "kind")
            self.assertFalse(envs["kshared"].allow_deploy)

    def test_bad_strategy_raises(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: magic}
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "must be 'token' or 'dev'"):
                load_environments([path])

    def test_token_strategy_needs_token_env(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: token}
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "requires auth.token_env"):
                load_environments([path])

    def test_dev_strategy_needs_username(self):
        bad = """
version: "1"
environments:
  broken:
    url: http://example
    auth: {strategy: dev}
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "bad.yaml", bad)
            with self.assertRaisesRegex(ValueError, "requires auth.username"):
                load_environments([path])


class TestResolveEnvironment(unittest.TestCase):
    """resolve_environment lookup by name."""

    def test_known_env(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            env = resolve_environment("staging", [path])
            self.assertEqual(env.name, "staging")

    def test_unknown_env_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            with self.assertRaisesRegex(KeyError, "Unknown environment"):
                resolve_environment("does-not-exist", [path])


class TestResolveToken(unittest.TestCase):
    """resolve_token env var lookup."""

    def test_reads_token_env_var(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            env = resolve_environment("staging", [path])
            os.environ["OETF_TOKEN"] = "tok-123"
            try:
                self.assertEqual(resolve_token(env), "tok-123")
            finally:
                del os.environ["OETF_TOKEN"]

    def test_unset_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            env = resolve_environment("staging", [path])
            os.environ.pop("OETF_TOKEN", None)
            self.assertEqual(resolve_token(env), "")

    def test_dev_strategy_returns_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            env = resolve_environment("kind", [path])
            self.assertEqual(resolve_token(env), "")


class TestPreflightCheckAuth(unittest.TestCase):
    """preflight.check_auth() on EnvironmentConfig."""

    def _load(self, name: str):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = _write(tmpdir, "canonical.yaml", CANONICAL_YAML)
            return resolve_environment(name, [path])

    def test_token_ok_when_env_set(self):
        env = self._load("staging")
        os.environ["OETF_TOKEN"] = "tok"
        try:
            check_auth(env)  # should not raise
        finally:
            del os.environ["OETF_TOKEN"]

    def test_token_missing_raises_with_next(self):
        env = self._load("staging")
        os.environ.pop("OETF_TOKEN", None)
        with self.assertRaises(PreflightError) as ctx:
            check_auth(env)
        self.assertIn("OETF_TOKEN", ctx.exception.error)
        self.assertIn("osmo login", ctx.exception.next_fix)

    def test_dev_ok(self):
        env = self._load("kind")
        check_auth(env)  # should not raise


class TestPreflightCheckAuthConfig(unittest.TestCase):
    """preflight.check_auth_config() on raw fields (no --env path)."""

    def test_token_missing(self):
        with self.assertRaises(PreflightError) as ctx:
            check_auth_config("token", "", "")
        self.assertIn("token auth requires", ctx.exception.error)

    def test_token_present(self):
        check_auth_config("token", "tok", "")

    def test_dev_missing_username(self):
        with self.assertRaises(PreflightError):
            check_auth_config("dev", "", "")

    def test_dev_with_username(self):
        check_auth_config("dev", "", "user")

    def test_unknown_method(self):
        with self.assertRaises(PreflightError):
            check_auth_config("magic", "x", "y")


class TestCollectErrors(unittest.TestCase):
    """collect_errors enumerates rather than short-circuits."""

    def test_collects_all_failures(self):
        def fail_a():
            raise PreflightError("a failed", "fix a")

        def fail_b():
            raise PreflightError("b failed", "fix b")

        def pass_c():
            pass

        errors = collect_errors([fail_a, pass_c, fail_b])
        self.assertEqual(len(errors), 2)
        self.assertIn("a failed", errors[0].error)
        self.assertIn("b failed", errors[1].error)


class TestDefaultEnvironmentPaths(unittest.TestCase):
    """`default_environment_paths()` includes the internal overlay if present.

    Post-migration the public `oetf.default.yaml` ships only the `kind:` env;
    internal infra (`staging:`, `dev:`) lives in a sibling `oetf.internal.yaml`
    that's auto-discovered when present.
    """

    def test_internal_overlay_included_when_present(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = os.path.join(tmpdir, "oetf.default.yaml")
            overlay = os.path.join(tmpdir, "oetf.internal.yaml")
            with open(canonical, "w", encoding="utf-8") as f:
                f.write("environments: {}\n")
            with open(overlay, "w", encoding="utf-8") as f:
                f.write("environments: {}\n")
            with mock.patch.object(environments, "CANONICAL_PATH", canonical), \
                 mock.patch.object(environments, "INTERNAL_OVERLAY_PATH", overlay):
                paths = default_environment_paths()
        self.assertIn(canonical, paths)
        self.assertIn(overlay, paths)
        # Order: canonical → internal → user. Internal lands BETWEEN canonical
        # and user so its env entries override the default but lose to user.
        self.assertLess(paths.index(canonical), paths.index(overlay))

    def test_internal_overlay_omitted_when_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = os.path.join(tmpdir, "oetf.default.yaml")
            overlay_missing = os.path.join(tmpdir, "oetf.internal.yaml")
            with open(canonical, "w", encoding="utf-8") as f:
                f.write("environments: {}\n")
            # overlay_missing intentionally NOT created
            with mock.patch.object(environments, "CANONICAL_PATH", canonical), \
                 mock.patch.object(environments, "INTERNAL_OVERLAY_PATH", overlay_missing):
                paths = default_environment_paths()
        self.assertIn(canonical, paths)
        self.assertNotIn(overlay_missing, paths)

    def test_internal_overlay_between_default_and_user(self):
        # Order matters: default → internal → user → CLI overrides.
        # User overlay path is always present (last in the returned list).
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = os.path.join(tmpdir, "oetf.default.yaml")
            overlay = os.path.join(tmpdir, "oetf.internal.yaml")
            for path in (canonical, overlay):
                with open(path, "w", encoding="utf-8") as f:
                    f.write("environments: {}\n")
            with mock.patch.object(environments, "CANONICAL_PATH", canonical), \
                 mock.patch.object(environments, "INTERNAL_OVERLAY_PATH", overlay):
                paths = default_environment_paths()
        self.assertEqual(len(paths), 3)
        self.assertEqual(paths[0], canonical)
        self.assertEqual(paths[1], overlay)
        # paths[2] is USER_OVERLAY_PATH which is whatever the env says.

    def test_internal_overlay_envs_merged_on_top_of_default(self):
        """End-to-end: load_environments merges the internal overlay over defaults."""
        with tempfile.TemporaryDirectory() as tmpdir:
            canonical = os.path.join(tmpdir, "oetf.default.yaml")
            overlay = os.path.join(tmpdir, "oetf.internal.yaml")
            with open(canonical, "w", encoding="utf-8") as f:
                f.write(
                    "environments:\n"
                    "  kind:\n"
                    "    url: http://localhost\n"
                    "    auth: {strategy: dev, username: testuser}\n"
                    "    type: kind\n"
                    "    cluster_name: osmo\n"
                )
            with open(overlay, "w", encoding="utf-8") as f:
                f.write(
                    "environments:\n"
                    "  staging:\n"
                    "    url: https://staging.example\n"
                    "    auth: {strategy: token, token_env: OETF_TOKEN}\n"
                    "    type: custom\n"
                )
            with mock.patch.object(environments, "CANONICAL_PATH", canonical), \
                 mock.patch.object(environments, "INTERNAL_OVERLAY_PATH", overlay), \
                 mock.patch.object(environments, "USER_OVERLAY_PATH", "/nonexistent"):
                envs = load_environments()
        self.assertIn("kind", envs)
        self.assertIn("staging", envs)
        self.assertEqual(envs["staging"].url, "https://staging.example")


if __name__ == "__main__":
    unittest.main()
