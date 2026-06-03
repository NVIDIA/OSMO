"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Entry point for ``//test/oetf:deploy`` — deploy-only (no tests, no teardown).
#
# Adapter selection is driven by the resolved env's ``type`` field
# (currently only ``kind`` is implemented; ``dev`` lands in a follow-up).
# ``env.allow_deploy`` is the safety gate — set explicitly per-env in
# ``oetf.default.yaml``.

import argparse
import logging
import sys
from typing import List

from test.oetf import breadcrumb
from test.oetf.cli_args import add_deploy_args, add_env_args
from test.oetf.deploy_adapters.base import DeployParams, DeploySession, install_signal_shim
from test.oetf.deploy_adapters.factory import build_adapter
from test.oetf.deploy_adapters.kind_adapter import (
    check_kind_prereqs,
    print_chart_versions,
)
from test.oetf.environments import resolve_environment
from test.oetf.preflight import (
    PreflightError,
    check_auth,
    check_deployable,
    report_preflight_errors,
)

EXIT_SUCCESS = 0
EXIT_DEPLOY_FAILURE = 1
EXIT_FRAMEWORK_ERROR = 2
EXIT_INTERRUPTED = 130  # convention: 128 + SIGINT(2)

logger = logging.getLogger(__name__)


def parse_arguments(arguments: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy an OSMO environment (no tests, no teardown).",
    )
    add_env_args(parser)
    add_deploy_args(parser)
    return parser.parse_args(arguments)


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

    # Dev deploys flip cleanup_on_failure off — there's nothing to roll back
    # (we'd just be reverting an argocd commit, which the user can do
    # explicitly), and rolling back would silently drop their bumped
    # value-file commit on the floor.
    session = DeploySession(
        adapter, params,
        cleanup_on_failure=env.type == "kind",
        cleanup_on_exit=False,
        keep_on_failure=args.keep_on_failure,
    )
    try:
        resolved_env = session.start()
    except KeyboardInterrupt:
        logger.error("Deploy interrupted (signal received)")
        return EXIT_INTERRUPTED
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Deploy failed: %s", error)
        return EXIT_DEPLOY_FAILURE

    # Only kind deploys go in the breadcrumb — dev teardowns are no-ops, so
    # tracking them adds noise to ``oetf:teardown --list`` without enabling
    # any real cleanup action.
    if env.type == "kind":
        breadcrumb.upsert(breadcrumb.Breadcrumb.now(
            type=env.type,
            env_name=env.name,
            cluster_name=cluster_name,
        ))

    logger.info("Deploy complete: env=%s url=%s", resolved_env.name, resolved_env.url)
    logger.info(
        "Next: bazel run //test/oetf:run -- --env %s --tags smoke",
        env.name,
    )
    return EXIT_SUCCESS


if __name__ == "__main__":
    sys.exit(main())
