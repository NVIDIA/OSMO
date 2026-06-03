"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

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
from test.oetf.deploy_adapters.base import DeployParams, DeploySession, install_signal_shim
from test.oetf.deploy_adapters.factory import build_adapter
from test.oetf.deploy_adapters.kind_adapter import (
    check_kind_prereqs,
    print_chart_versions,
)
from test.oetf.environments import resolve_environment
from test.oetf.models import EnvironmentConfig
from test.oetf.preflight import (
    PreflightError,
    check_auth,
    check_deployable,
    report_preflight_errors,
)

EXIT_SUCCESS = 0
EXIT_TEST_FAILURE = 1
EXIT_FRAMEWORK_ERROR = 2
EXIT_INTERRUPTED = 130  # convention: 128 + SIGINT(2)

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
    Auth is resolved by the child via ``--env`` (token from $OSMO_*_TOKEN
    or username from env config); we only override auth fields for
    dev-auth envs where the deploy may have minted a fresh user.
    """
    cmd = ["bazel", "run", "//test/oetf:run", "--", "--env", args.env]
    cmd.extend(forward_env_args(args))
    cmd.extend(forward_run_args(args))
    # Pin to the freshly-deployed cluster — deploy_and_run is single-cluster
    # by construction.
    cmd.extend(["--url", deployed_env.url])
    if deployed_env.auth.strategy == "dev":
        cmd.extend(["--auth-method", "dev"])
        cmd.extend(["--auth-username", deployed_env.auth.username])
    if args.verbose:
        cmd.extend(["--bazel-arg", "--test_output=all"])
    logger.debug("Running: %s", " ".join(cmd))
    workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY", os.getcwd())
    result = subprocess.run(cmd, check=False, cwd=workspace)
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
    if not args.env:
        logger.error(
            "ERROR: --env is required\nNEXT:  pass --env <name> (see "
            "test_infra/oetf/data/oetf.default.yaml for available envs)"
        )
        return EXIT_FRAMEWORK_ERROR

    try:
        env = resolve_environment(args.env)
    except KeyError as error:
        logger.error("ERROR: %s", error)
        return EXIT_FRAMEWORK_ERROR

    try:
        check_deployable(env)
        check_auth(env)
    except PreflightError as error:
        logger.error("ERROR: %s", error.error)
        logger.error("NEXT:  %s", error.next_fix)
        return EXIT_FRAMEWORK_ERROR
    except NotImplementedError as error:
        logger.error("ERROR: %s", error)
        return EXIT_FRAMEWORK_ERROR
    try:
        if env.type == "kind":
            report_preflight_errors(check_kind_prereqs())
    except PreflightError:
        return EXIT_FRAMEWORK_ERROR

    cluster_name = args.cluster_name or env.cluster_name
    params = DeployParams(
        type=env.type,
        env_name=env.name,
        cluster_name=cluster_name,
        fresh=args.fresh,
    )

    try:
        adapter = build_adapter(args, env)
    except (ValueError, NotImplementedError) as error:
        logger.error("ERROR: %s", error)
        return EXIT_FRAMEWORK_ERROR

    # Read-only state checks before DeploySession opens — failures here
    # do not roll back the existing cluster.
    try:
        adapter.pre_deploy_check(params)
    except PreflightError as error:
        logger.error("ERROR: %s", error.error)
        logger.error("NEXT:  %s", error.next_fix)
        return EXIT_FRAMEWORK_ERROR
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Deploy aborted: %s", error)
        return EXIT_FRAMEWORK_ERROR

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
            cluster_name=cluster_name,
        ))

    try:
        test_exit = _run_tests(args, deployed_env)
    finally:
        if env.type == "kind" and not args.keep:
            session.stop()

    return EXIT_SUCCESS if test_exit == 0 else EXIT_TEST_FAILURE


if __name__ == "__main__":
    sys.exit(main())
