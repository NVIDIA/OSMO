"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# No-op adapter for externally-managed envs (staging, prod, already-deployed dev).
#
# Used when a test-run needs to point at an environment the tool does not own.
# Calling ``teardown`` on this adapter is deliberately a no-op — we never
# destroy externally-managed infra.

import dataclasses
import logging

from test.oetf.deploy_adapters.base import DeployParams
from test.oetf.environments import resolve_environment
from test.oetf.models import EnvironmentConfig

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class NoopAdapter:
    """Resolves an already-running environment by name from environments.yaml."""

    def pre_deploy_check(self, params: DeployParams) -> None:  # pylint: disable=unused-argument
        # Externally-managed envs have no state we own to validate.
        return

    def deploy(self, params: DeployParams) -> EnvironmentConfig:
        if not params.env_name:
            raise ValueError("NoopAdapter requires params.env_name")
        env = resolve_environment(params.env_name)
        logger.info("Resolved noop env '%s' at %s", env.name, env.url)
        return env

    def configure(self, env: EnvironmentConfig) -> None:  # pylint: disable=unused-argument
        # Externally-managed envs are configured out-of-band.
        return

    def teardown(self, params: DeployParams) -> None:
        logger.info(
            "NoopAdapter.teardown: env '%s' is externally managed — no action",
            params.env_name,
        )
