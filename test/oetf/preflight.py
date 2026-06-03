"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Pre-flight checks for OETF runs.
#
# Every user-facing error follows the ``ERROR: <what> / NEXT: <fix>`` contract
# so AI agents can regex the ``NEXT:`` line and humans can copy-paste the fix.

import logging
import os
from typing import List

from test_infra.oetf.models import EnvironmentConfig

logger = logging.getLogger(__name__)


class PreflightError(Exception):
    """A pre-flight check failed with an actionable recovery instruction."""

    def __init__(self, error: str, next_fix: str):
        self.error = error
        self.next_fix = next_fix
        super().__init__(f"\nERROR: {error}\nNEXT:  {next_fix}")


def check_auth(env: EnvironmentConfig) -> None:
    """Verify that an env's auth prerequisites are satisfied.

    Lightweight: only checks that required env vars are set / fields are
    present. Does not validate the token against the server.
    """
    if env.auth.strategy == "token":
        if not env.auth.token_env:
            raise PreflightError(
                f"env '{env.name}' uses strategy=token but has no token_env",
                f"set 'auth.token_env: YOUR_ENV_VAR' in environments.yaml for '{env.name}'",
            )
        if not os.environ.get(env.auth.token_env, ""):
            raise PreflightError(
                f"env '{env.name}' requires ${env.auth.token_env} (unset)",
                f"osmo login {env.url} && osmo token set oetf --roles osmo-admin && "
                f"export {env.auth.token_env}=<token>",
            )
    elif env.auth.strategy == "dev":
        if not env.auth.username:
            raise PreflightError(
                f"env '{env.name}' uses strategy=dev but has no username",
                f"set 'auth.username: <user>' in environments.yaml for '{env.name}'",
            )
    else:
        raise PreflightError(
            f"env '{env.name}' has unsupported auth.strategy '{env.auth.strategy}'",
            "use 'token' or 'dev'",
        )


def check_auth_config(auth_method: str, auth_token: str, auth_username: str) -> None:
    """Pre-check for auth supplied directly via ``--auth-*`` flags (no --env).

    Equivalent to :func:`check_auth` but operates on raw OetfConfig fields for
    the legacy ``--url + --auth-token`` path.
    """
    if auth_method == "token":
        if not auth_token:
            raise PreflightError(
                "token auth requires --auth-token or $OSMO_ACCESS_TOKEN (unset)",
                "export OSMO_ACCESS_TOKEN=<token>  # or pass --auth-token <token>",
            )
    elif auth_method == "dev":
        if not auth_username:
            raise PreflightError(
                "dev auth requires --auth-username",
                "pass --auth-username <user>",
            )
    else:
        raise PreflightError(
            f"unsupported --auth-method '{auth_method}'",
            "use --auth-method token or --auth-method dev",
        )


def collect_errors(checks: List) -> List[PreflightError]:
    """Run a list of zero-arg check callables and collect all failures.

    Unlike ``check_auth`` (which raises on first failure), this enumerates
    every failure before returning.
    """
    errors: List[PreflightError] = []
    for check in checks:
        try:
            check()
        except PreflightError as error:
            errors.append(error)
    return errors


def check_deployable(env: EnvironmentConfig) -> None:
    """Raise ``PreflightError`` unless ``env`` can be deployed to."""
    if env.type == "custom":
        raise PreflightError(
            f"env '{env.name}' (type=custom) cannot be deployed to — "
            f"custom envs are externally managed",
            "pick a deployable env, or change its type to 'kind' or 'dev' and "
            "set allow_deploy: true in environments.yaml",
        )
    if not env.allow_deploy:
        raise PreflightError(
            f"env '{env.name}' has allow_deploy=false",
            f"set 'allow_deploy: true' in environments.yaml for '{env.name}' "
            f"if you intend to deploy to it",
        )


def report_preflight_errors(errors: List[PreflightError]) -> None:
    """Log a list of pre-flight errors in the ``ERROR/NEXT`` contract and raise."""
    if not errors:
        return
    logger.error("Pre-flight failed — fix all of the following and retry:")
    for error in errors:
        logger.error("  ERROR: %s", error.error)
        logger.error("  NEXT:  %s", error.next_fix)
    raise PreflightError(
        f"{len(errors)} pre-flight check(s) failed",
        "see errors above",
    )
