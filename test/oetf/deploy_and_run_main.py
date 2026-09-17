"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Entry point for ``//test/oetf:deploy_and_run`` — deploy → run tests → teardown.
#
# Thin composition of deploy (via KindAdapter) and the Bazel-native test
# wrapper (oetf:run). KIND clusters are torn down on exit unless ``--keep``.
# Adapter selection is driven by ``env.type`` (from ``oetf.default.yaml``).

import argparse
import logging
import os
import subprocess
import sys
from typing import List

from test.oetf import breadcrumb
from test.oetf.cli_args import (
    add_deploy_args,
    add_env_args,
    add_run_args,
    forward_env_args,
    forward_run_args,
)
from test.oetf.deploy_adapters.base import DeploySession, install_signal_shim
from test.oetf.deploy_adapters.kind_adapter import print_chart_versions
from test.oetf.deploy_pipeline import prepare_deploy
from test.oetf.models import EnvironmentConfig

EXIT_SUCCESS = 0
EXIT_TEST_FAILURE = 1
EXIT_FRAMEWORK_ERROR = 2
EXIT_INTERRUPTED = 130  # convention: 128 + SIGINT(2)
ADMIN_TOKEN_SECRET = "osmo-admin-token"
OSMO_NAMESPACE = "osmo"

logger = logging.getLogger(__name__)


def parse_arguments(arguments: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy OSMO, run OETF tests against it, then tear down.",
    )
    add_env_args(parser)
    add_deploy_args(parser)
    add_run_args(parser)
    parser.add_argument(
        "--keep", action="store_true",
        help="Skip teardown after tests (leave cluster running for inspection). "
             "deploy_and_run-only — separates this from --keep-on-failure (which "
             "applies to the deploy phase only).",
    )
    # ``--tags`` defaults to ``smoke`` for deploy_and_run (it's the one-shot
    # CI flow's expected behavior); ``oetf:run`` keeps the empty default.
    parser.set_defaults(tags="smoke")
    return parser.parse_args(arguments)


def _run_tests(args: argparse.Namespace, deployed_env: EnvironmentConfig) -> int:
    """Shell out to ``oetf:run`` for the test phase; return its exit code.

    All env-side and run-side flags from our parsed namespace forward
    automatically via ``forward_env_args`` / ``forward_run_args`` (defined
    by ``cli_args.py``). The deploy-side flags (``--build-local`` etc.)
    are intentionally not forwarded — they apply to the deploy phase only.

    The deployed env's URL overrides whatever the user passed via ``--url``
    because deploy_and_run only runs against the cluster it just brought up.
    Auth is resolved by the child via ``--env``. Local-source Kind deploys use
    the managed administrator token created by the chart; dev-auth environments
    use the username from their environment config.
    """
    cmd = ["bazel", "run", "//test/oetf:run", "--", "--env", args.env]
    cmd.extend(forward_env_args(args))
    cmd.extend(forward_run_args(args))
    # Pin to the freshly-deployed cluster — deploy_and_run is single-cluster
    # by construction.
    cmd.extend(["--url", deployed_env.url])
    test_environment = os.environ.copy()
    if deployed_env.type == "kind" and not args.build_local:
        # The released quick-start chart does not provide the MCP service.
        # Preserve any caller filters while excluding that unavailable surface.
        tag_filters = ""
        for argument in getattr(args, "bazel_arg", []):
            if argument.startswith("--test_tag_filters="):
                tag_filters = argument.partition("=")[2]
        tag_filters = ",".join(filter(None, (tag_filters, "-mcp")))
        cmd.append(f"--bazel-arg=--test_tag_filters={tag_filters}")
    if args.build_local and deployed_env.type == "kind":
        cluster_name = args.cluster_name or deployed_env.cluster_name or "osmo"
        token_result = subprocess.run(
            [
                "kubectl", "--context", f"kind-{cluster_name}",
                "get", "secret", ADMIN_TOKEN_SECRET,
                "--namespace", OSMO_NAMESPACE,
                "--output", 'go-template={{ index .data "token" | base64decode }}',
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        token = token_result.stdout.strip()
        if token_result.returncode != 0 or not token:
            logger.error(
                "Unable to read managed administrator token Secret %s: %s",
                ADMIN_TOKEN_SECRET,
                token_result.stderr[:500].strip(),
            )
            return EXIT_FRAMEWORK_ERROR
        cmd.extend(["--auth-method", "token"])
        test_environment["OSMO_ACCESS_TOKEN"] = token
    elif deployed_env.auth.strategy == "dev":
        cmd.extend(["--auth-method", "dev"])
        cmd.extend(["--auth-username", deployed_env.auth.username])
    if args.verbose:
        cmd.extend(["--bazel-arg", "--test_output=all"])
    logger.debug("Running: %s", " ".join(cmd))
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    result = subprocess.run(
        cmd, check=False, cwd=workspace, env=test_environment,
    )
    return result.returncode


def main(arguments: List[str] | None = None) -> int:
    install_signal_shim()
    args = parse_arguments(arguments)

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if args.list_versions:
        return print_chart_versions()

    prepared = prepare_deploy(args)
    if prepared is None:
        return EXIT_FRAMEWORK_ERROR
    env, params, adapter = prepared

    session = DeploySession(
        adapter, params,
        cleanup_on_failure=env.type == "kind",
        keep_on_failure=args.keep_on_failure,
    )

    try:
        deployed_env = session.start()
    except KeyboardInterrupt:
        logger.error("Deploy interrupted (signal received)")
        return EXIT_INTERRUPTED
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Deploy failed: %s", error)
        return EXIT_FRAMEWORK_ERROR

    if env.type == "kind":
        breadcrumb.upsert(breadcrumb.Breadcrumb.now(
            type=env.type,
            env_name=env.name,
            cluster_name=params.cluster_name,
        ))

    try:
        test_exit = _run_tests(args, deployed_env)
    finally:
        if env.type == "kind" and not args.keep:
            session.stop()

    return EXIT_SUCCESS if test_exit == 0 else EXIT_TEST_FAILURE


if __name__ == "__main__":
    sys.exit(main())
