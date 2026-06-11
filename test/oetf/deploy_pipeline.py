"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Shared pre-DeploySession pipeline for ``oetf:deploy`` and
# ``oetf:deploy_and_run``. Both entry points validate the env the same way,
# build the same adapter, and run the same ``pre_deploy_check`` — the only
# divergence is what happens after ``session.start()`` (deploy stops there;
# deploy_and_run continues into ``oetf:run``).

import argparse
import logging
from typing import Optional, Tuple

from test.oetf.deploy_adapters.base import DeployAdapter, DeployParams
from test.oetf.deploy_adapters.factory import build_adapter
from test.oetf.deploy_adapters.kind_adapter import check_kind_prereqs
from test.oetf.environments import resolve_environment
from test.oetf.models import EnvironmentConfig
from test.oetf.preflight import (
    PreflightError,
    check_auth,
    check_deployable,
    report_preflight_errors,
)

logger = logging.getLogger(__name__)


def prepare_deploy(
    args: argparse.Namespace,
) -> Optional[Tuple[EnvironmentConfig, DeployParams, DeployAdapter]]:
    """Resolve env, run preflights, build adapter, run pre_deploy_check.

    Returns ``(env, params, adapter)`` on success, or ``None`` on any failure
    (errors already logged in the ``ERROR:`` / ``NEXT:`` contract). Callers
    map ``None`` to whatever exit code fits — typically EXIT_FRAMEWORK_ERROR.
    """
    if not args.env:
        logger.error(
            "ERROR: --env is required\nNEXT:  pass --env <name> (see "
            "test/oetf/data/oetf.default.yaml for available envs)"
        )
        return None

    try:
        env = resolve_environment(args.env)
    except KeyError as error:
        logger.error("ERROR: %s", error)
        return None

    try:
        check_deployable(env)
        check_auth(env)
    except PreflightError as error:
        logger.error("ERROR: %s", error.error)
        logger.error("NEXT:  %s", error.next_fix)
        return None
    try:
        if env.type == "kind":
            report_preflight_errors(check_kind_prereqs())
    except PreflightError:
        return None

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
        return None

    # Read-only state checks before DeploySession opens — failures here
    # do not roll back the existing cluster.
    try:
        adapter.pre_deploy_check(params)
    except PreflightError as error:
        logger.error("ERROR: %s", error.error)
        logger.error("NEXT:  %s", error.next_fix)
        return None
    except Exception as error:  # pylint: disable=broad-except
        logger.error("Deploy aborted: %s", error)
        return None

    return env, params, adapter
