"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Entry point for ``//test/oetf:teardown`` — destroy a deployed env.
#
# Always explicit: pass ``--env <name>`` to tear down one env, or
# ``--list`` to see what's currently active. Dev envs are persistent
# infrastructure (no-op teardown) and are never tracked in the
# breadcrumb; only kind clusters appear in ``--list``.

import argparse
import logging
import sys
from typing import List, Optional

from test_infra.oetf import breadcrumb
from test_infra.oetf.deploy_adapters import factory
from test_infra.oetf.deploy_adapters.base import DeployParams
from test_infra.oetf.environments import resolve_environment

EXIT_SUCCESS = 0
EXIT_TEARDOWN_FAILURE = 1
EXIT_FRAMEWORK_ERROR = 2

logger = logging.getLogger(__name__)


def parse_arguments(arguments: List[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Tear down a deployed OSMO environment. Pass --env <name> to "
            "tear down one env, or --list to see active deploys. Only kind "
            "clusters are tracked — dev envs are persistent infrastructure "
            "and their teardown is a no-op."
        ),
    )
    parser.add_argument(
        "--env", default="",
        help="Env to tear down (required unless --list is passed). For kind "
             "envs the cluster_name comes from the breadcrumb if present, "
             "else from oetf.default.yaml.",
    )
    parser.add_argument(
        "--list", action="store_true", dest="list_deploys",
        help="Print the active deploys recorded in the breadcrumb and exit.",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable debug logging.",
    )
    return parser.parse_args(arguments)


def _teardown_one(env_name: str, crumb: Optional[breadcrumb.Breadcrumb]) -> int:
    """Tear down ``env_name``. Returns exit code (0 on success).

    ``crumb`` (when present) supplies a runtime ``cluster_name`` that
    overrides the env's YAML default — kind cluster names can differ if
    ``--cluster-name`` was passed at deploy time. The matching breadcrumb
    entry is removed on successful teardown.
    """
    try:
        env = resolve_environment(env_name)
    except KeyError as error:
        logger.error("ERROR: %s", error)
        return EXIT_FRAMEWORK_ERROR

    cluster_name = env.cluster_name
    if crumb and crumb.cluster_name:
        cluster_name = crumb.cluster_name

    params = DeployParams(
        type=env.type,
        env_name=env.name,
        cluster_name=cluster_name,
    )

    try:
        adapter = factory.build_teardown_adapter(env)
    except ValueError as error:
        logger.error("ERROR: %s", error)
        return EXIT_FRAMEWORK_ERROR

    try:
        adapter.teardown(params)
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Teardown failed for env=%s: %s", env.name, error)
        return EXIT_TEARDOWN_FAILURE

    breadcrumb.remove(env.name)
    logger.info("Teardown complete for env=%s (type=%s)", env.name, env.type)
    return EXIT_SUCCESS


def _print_list(crumbs: List[breadcrumb.Breadcrumb]) -> None:
    if not crumbs:
        logger.info("No active deploys recorded at %s.", breadcrumb.DEFAULT_PATH)
        return
    logger.info("Active deploys (%d):", len(crumbs))
    for crumb in crumbs:
        cluster = f" cluster={crumb.cluster_name}" if crumb.cluster_name else ""
        logger.info(
            "  %s (type=%s%s, deployed_at=%s)",
            crumb.env_name, crumb.type, cluster, crumb.deployed_at,
        )


def main(arguments: List[str] | None = None) -> int:
    args = parse_arguments(arguments)

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if args.list_deploys:
        if args.env:
            logger.error("ERROR: --list and --env are mutually exclusive")
            return EXIT_FRAMEWORK_ERROR
        _print_list(breadcrumb.read_all())
        return EXIT_SUCCESS

    if not args.env:
        logger.error(
            "ERROR: --env <name> is required.\n"
            "NEXT:  pass --env <name> to tear down a specific env, or "
            "--list to see active deploys."
        )
        return EXIT_FRAMEWORK_ERROR

    return _teardown_one(args.env, breadcrumb.find(args.env))


if __name__ == "__main__":
    sys.exit(main())
