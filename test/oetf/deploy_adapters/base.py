"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Deploy port (Protocol) and the ``DeploySession`` orchestrator.
#
# The Protocol is intentionally minimal: ``deploy``, ``configure``, ``teardown``.
# Repeated calls to ``deploy`` with different params express upgrades (see D15 in
# the plan) so transition testing (M6) and Kargo (M8) add adapters, not methods.

import dataclasses
import logging
import signal
from typing import Dict, Protocol

from test.oetf.models import DeployType, EnvironmentConfig

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class DeployParams:
    """Parameters passed to a DeployAdapter. Extra keys go into ``extras``."""
    type: DeployType
    env_name: str = ""              # name of the env being deployed into
    cluster_name: str = ""          # KIND cluster name, when applicable
    image_tag: str = ""             # image tag (dev adapter)
    ref: str = ""                   # git ref (dev adapter)
    fresh: bool = False             # force recreate (KIND: kind delete before kind create)
    extras: Dict[str, str] = dataclasses.field(default_factory=dict)


class DeployAdapter(Protocol):
    """Port for environment deploy/configure/teardown lifecycle.

    Implementations must be idempotent on ``teardown`` so the Session can
    safely call it after a partial deploy failure.
    """

    def pre_deploy_check(self, params: DeployParams) -> None:
        """Optional read-only checks against current target state.

        Called by the entry-point binaries BEFORE entering ``DeploySession``,
        so an abort here does not trigger rollback teardown — the existing
        state is untouched. Use for catching user-input errors that depend
        on what's already deployed (e.g. value-drift between invocations).
        Default: no-op.
        """

    def deploy(self, params: DeployParams) -> EnvironmentConfig:
        """Reach the desired deployed state. Repeated calls with new params express upgrades."""

    def configure(self, env: EnvironmentConfig) -> None:
        """Apply post-deploy configuration (service configs, pool defaults, etc)."""

    def teardown(self, params: DeployParams) -> None:
        """Destroy the deployed target. MUST be idempotent (no-op if nothing to destroy)."""


class DeploySession:
    """Context manager that sequences deploy → configure, with cleanup on failure.

    Usage (oetf:deploy — deploy-only, no teardown on normal exit)::

        session = DeploySession(adapter, params, cleanup_on_failure=True)
        env = session.start()       # deploy + configure
        # ... no teardown; caller decides when ...

    Usage (oetf:deploy_and_run — composition)::

        with DeploySession(adapter, params, cleanup_on_failure=True,
                           cleanup_on_exit=True) as env:
            runner.run(...)
        # teardown fires on exit; on deploy failure it also fires, then re-raises.

    Cleanup rules (see D10b):
        * Exception during deploy/configure → teardown + re-raise, unless ``keep_on_failure``.
        * Test failure (after session enters normally) → no teardown unless ``cleanup_on_exit``.
        * Normal exit → teardown only if ``cleanup_on_exit``.
    """

    def __init__(
        self,
        adapter: DeployAdapter,
        params: DeployParams,
        cleanup_on_failure: bool = True,
        cleanup_on_exit: bool = False,
        keep_on_failure: bool = False,
    ):
        self.adapter = adapter
        self.params = params
        self.cleanup_on_failure = cleanup_on_failure
        self.cleanup_on_exit = cleanup_on_exit
        self.keep_on_failure = keep_on_failure
        self.env: EnvironmentConfig | None = None
        self._started = False

    def start(self) -> EnvironmentConfig:
        """Run deploy + configure. Raises after best-effort teardown on failure."""
        try:
            self.env = self.adapter.deploy(self.params)
            self.adapter.configure(self.env)
        except BaseException:
            if self.cleanup_on_failure and not self.keep_on_failure:
                logger.warning(
                    "Deploy failed — rolling back partial state for type=%s env=%s",
                    self.params.type, self.params.env_name,
                )
                try:
                    self.adapter.teardown(self.params)
                except Exception as teardown_error:  # pylint: disable=broad-except
                    logger.error(
                        "Rollback teardown raised (continuing to re-raise original): %s",
                        teardown_error,
                    )
            elif self.keep_on_failure:
                logger.warning(
                    "Deploy failed — keeping partial state (--keep-on-failure set)",
                )
            raise
        self._started = True
        return self.env

    def stop(self) -> None:
        """Best-effort teardown. Logs but does not raise."""
        try:
            self.adapter.teardown(self.params)
        except Exception as error:  # pylint: disable=broad-except
            logger.error("Teardown raised: %s", error)

    def __enter__(self) -> EnvironmentConfig:
        return self.start()

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        if self.cleanup_on_exit and self._started:
            self.stop()


def install_signal_shim() -> None:
    """Translate SIGTERM into KeyboardInterrupt so ``__exit__`` fires under CI timeouts.

    Python's default SIGTERM handler ``sys.exit`` does not unwind context
    managers the way an exception does, so long-running deploys leak resources
    when CI kills the process. Idempotent.
    """
    def _handler(signum: int, frame) -> None:  # pylint: disable=unused-argument
        raise KeyboardInterrupt("received SIGTERM")

    signal.signal(signal.SIGTERM, _handler)
