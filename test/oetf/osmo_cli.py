"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# osmo CLI helpers shared between SmokeFixture and RunnerFixture.

from __future__ import annotations

import logging
import os
import shutil
import subprocess

from test_infra.oetf.models import OetfConfig


logger = logging.getLogger(__name__)

_COMMON_OSMO_CLI_PATHS = ["/usr/local/bin/osmo", "/opt/homebrew/bin/osmo"]


def resolve_osmo_cli(config: OetfConfig) -> str:
    """Return the osmo CLI path to use. Raises RuntimeError if not found.

    bazel run can strip /usr/local/bin from PATH, so fall back to common
    install locations before giving up.
    """
    if config.local_osmo:
        return config.local_osmo
    found = shutil.which("osmo")
    if found:
        return found
    for candidate in _COMMON_OSMO_CLI_PATHS:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise RuntimeError(
        "osmo CLI not found on PATH or in common install locations. "
        "Install via `curl -fsSL https://artifactory.example.com/"
        "sw-osmo-generic-local/<env>/cli/install.sh | bash`, "
        "or pass --local-osmo <path>."
    )


def login_cli_to(config: OetfConfig) -> None:
    """Log the osmo CLI in to config.url. Raises RuntimeError on failure."""
    cli_path = resolve_osmo_cli(config)
    commands = [cli_path, "login", config.url, f"--method={config.auth_method}"]
    if config.auth_method == "token" and config.auth_token:
        commands.extend(["--token", config.auth_token])
    elif config.auth_method == "dev" and config.auth_username:
        commands.extend(["--username", config.auth_username])
    logger.info("Logging in CLI to %s (method=%s)...", config.url, config.auth_method)
    result = subprocess.run(commands, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"CLI login to {config.url} failed: {result.stderr[:500]}"
        )
    logger.info("CLI login successful")
