"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Equivalence tests for the OETF CLI argument layout.
#
# These tests guard against the historical drift bugs (e.g. ``--auth-method``
# regressed in run, ``--list-versions`` missing on deploy_and_run, ``--set``
# vs ``--extra-set``). They assert that ``oetf:deploy_and_run`` is a
# proper superset of ``oetf:deploy`` (env + deploy args) and ``oetf:run``
# (env + run args), and that ``forward_run_args`` covers every flag
# ``add_run_args`` declares.

import argparse
import unittest
from typing import Set

from test.oetf import cli_args


def _flag_set(*adders) -> Set[str]:
    """Collect the long-option strings registered by the given add_* helpers."""
    parser = argparse.ArgumentParser(add_help=False)
    for adder in adders:
        adder(parser)
    flags: Set[str] = set()
    for action in parser._actions:  # pylint: disable=protected-access
        for opt in action.option_strings:
            if opt.startswith("--"):
                flags.add(opt)
    return flags


class TestCliArgConsistency(unittest.TestCase):
    """deploy_and_run must accept every flag deploy + run accept."""

    def test_deploy_and_run_includes_all_deploy_flags(self):
        deploy_flags = _flag_set(cli_args.add_env_args, cli_args.add_deploy_args)
        compose_flags = _flag_set(
            cli_args.add_env_args, cli_args.add_deploy_args, cli_args.add_run_args,
        )
        missing = deploy_flags - compose_flags
        self.assertFalse(
            missing,
            f"deploy_and_run is missing deploy flags: {sorted(missing)}",
        )

    def test_deploy_and_run_includes_all_run_flags(self):
        run_flags = _flag_set(cli_args.add_env_args, cli_args.add_run_args)
        compose_flags = _flag_set(
            cli_args.add_env_args, cli_args.add_deploy_args, cli_args.add_run_args,
        )
        missing = run_flags - compose_flags
        self.assertFalse(
            missing,
            f"deploy_and_run is missing run flags: {sorted(missing)}",
        )

    def test_no_collision_between_deploy_and_run_args(self):
        """Same flag in both add_deploy_args and add_run_args would mean
        the meaning shifts depending on which binary it's parsed by — a
        latent ambiguity."""
        deploy_only = _flag_set(cli_args.add_deploy_args)
        run_only = _flag_set(cli_args.add_run_args)
        env_shared = _flag_set(cli_args.add_env_args)
        # --env / --url / etc are intentionally in env_args (shared layer);
        # neither deploy nor run should redeclare them.
        self.assertFalse(
            deploy_only & env_shared,
            "deploy_args must not redeclare env flags",
        )
        self.assertFalse(
            run_only & env_shared,
            "run_args must not redeclare env flags",
        )
        self.assertFalse(
            deploy_only & run_only,
            f"deploy/run flag collision: {sorted(deploy_only & run_only)}",
        )


class TestForwardRunArgs(unittest.TestCase):
    """Every flag declared by ``add_run_args`` must be forwardable.

    Catches the case where someone adds a new run-side flag but forgets to
    register it in ``cli_args._RUN_ARG_TABLE`` — which would silently drop
    the flag when ``deploy_and_run`` shells out to ``oetf:run``.
    """

    def test_every_run_flag_round_trips(self):
        # Build a parser with run args, parse a fully-set namespace, then
        # forward and check every declared flag is present in the output.
        parser = argparse.ArgumentParser(add_help=False)
        cli_args.add_run_args(parser)
        argv = [
            "--tags", "smoke",
            "--name", "test_foo",
            "--jobs", "5",
            "--output-json", "/tmp/r.json",
            "--local-osmo", "/usr/local/bin/osmo",
            "--data-cred-access-key-id", "AK",
            "--data-cred-access-key", "SK",
            "--data-cred-endpoint", "swift://e",
            "--data-cred-region", "us-east-1",
            "--bazel-arg=--test_output=all",
            "--target-pattern", "//x/...",
        ]
        args = parser.parse_args(argv)
        forwarded = cli_args.forward_run_args(args)

        # Every declared run flag should appear in the forwarded argv.
        for action in parser._actions:  # pylint: disable=protected-access
            for opt in action.option_strings:
                if opt.startswith("--"):
                    self.assertIn(
                        opt, forwarded,
                        f"add_run_args declared {opt!r} but forward_run_args "
                        f"didn't include it — register it in _RUN_ARG_TABLE.",
                    )

    def test_unset_flags_are_not_forwarded(self):
        """Empty defaults should not produce stray ``--flag ''`` in the argv."""
        parser = argparse.ArgumentParser(add_help=False)
        cli_args.add_run_args(parser)
        args = parser.parse_args([])
        forwarded = cli_args.forward_run_args(args)
        # Default --jobs=3 is a non-empty default; everything else empty.
        # The forwarder skips empty/zero values.
        self.assertNotIn("--tags", forwarded)
        self.assertNotIn("--name", forwarded)


class TestTargetPattern(unittest.TestCase):
    """`--target-pattern` flag + `parse_target_patterns` helper.

    Post-migration this lets a single `oetf run` invocation combine internal
    overlay paths with public framework paths. Today's behavior (no flag) must
    keep working unchanged.
    """

    _DEFAULT = "//test/..."

    def _parse(self, *argv):
        parser = argparse.ArgumentParser(add_help=False)
        cli_args.add_run_args(parser)
        return parser.parse_args(list(argv))

    def test_default_when_not_supplied(self):
        args = self._parse()
        self.assertEqual(args.target_pattern, [])
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, [self._DEFAULT])

    def test_single_value(self):
        args = self._parse("--target-pattern", "//foo/...")
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//foo/..."])

    def test_repeated_flag(self):
        args = self._parse("--target-pattern", "//a/...", "--target-pattern", "//b/...")
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/...", "//b/..."])

    def test_comma_joined(self):
        args = self._parse("--target-pattern", "//a/...,//b/...")
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/...", "//b/..."])

    def test_mixed_comma_and_repeated(self):
        args = self._parse(
            "--target-pattern", "//a/...,//b/...",
            "--target-pattern", "//c/...",
        )
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/...", "//b/...", "//c/..."])

    def test_dedupes_duplicates(self):
        args = self._parse(
            "--target-pattern", "//a/...,//a/...",
            "--target-pattern", "//a/...",
        )
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/..."])

    def test_whitespace_around_commas_stripped(self):
        args = self._parse("--target-pattern", " //a/... , //b/... ")
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/...", "//b/..."])

    def test_empty_parts_ignored(self):
        args = self._parse("--target-pattern", ",//a/...,,//b/...,")
        flat = cli_args.parse_target_patterns(args.target_pattern, self._DEFAULT)
        self.assertEqual(flat, ["//a/...", "//b/..."])

    def test_forwarded_in_run_arg_table(self):
        """deploy_and_run must forward --target-pattern to its run subprocess."""
        parser = argparse.ArgumentParser(add_help=False)
        cli_args.add_run_args(parser)
        args = parser.parse_args(["--target-pattern", "//x/...", "--target-pattern", "//y/..."])
        forwarded = cli_args.forward_run_args(args)
        # `list` kind: emits the flag once per entry.
        self.assertEqual(forwarded.count("--target-pattern"), 2)
        self.assertIn("//x/...", forwarded)
        self.assertIn("//y/...", forwarded)


if __name__ == "__main__":
    unittest.main()
