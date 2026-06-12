"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Data types for the OETF framework.
#
# Only two shapes survive from the pre-Bazel-migration era:
# - OetfConfig: per-invocation config, populated from OETF_* env vars.
# - WorkflowServerStatus: mirrors the OSMO API's status strings; `.terminal`
#   drives WorkflowHandle.wait_for_terminal.

import dataclasses
import enum
import os
from typing import Dict, List, Literal

AuthStrategy = Literal["token", "dev"]
DeployType = Literal["kind", "dev", "custom"]
DeployMode = Literal["cpu", "gpu"]


class WorkflowServerStatus(enum.Enum):
    """Server-side workflow statuses from the OSMO API."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    WAITING = "WAITING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    FAILED_SUBMISSION = "FAILED_SUBMISSION"
    FAILED_SERVER_ERROR = "FAILED_SERVER_ERROR"
    FAILED_EXEC_TIMEOUT = "FAILED_EXEC_TIMEOUT"
    FAILED_QUEUE_TIMEOUT = "FAILED_QUEUE_TIMEOUT"
    FAILED_CANCELED = "FAILED_CANCELED"
    FAILED_BACKEND_ERROR = "FAILED_BACKEND_ERROR"
    FAILED_IMAGE_PULL = "FAILED_IMAGE_PULL"
    FAILED_EVICTED = "FAILED_EVICTED"
    FAILED_START_ERROR = "FAILED_START_ERROR"
    FAILED_START_TIMEOUT = "FAILED_START_TIMEOUT"
    FAILED_PREEMPTED = "FAILED_PREEMPTED"

    @property
    def terminal(self) -> bool:
        return self not in (
            WorkflowServerStatus.PENDING,
            WorkflowServerStatus.RUNNING,
            WorkflowServerStatus.WAITING,
        )


@dataclasses.dataclass
class EnvironmentAuth:
    strategy: AuthStrategy
    token_env: str = ""
    username: str = ""


@dataclasses.dataclass
class EnvironmentConfig:
    """Resolved per-environment config consumed by deploy adapters and the runner."""
    name: str
    url: str
    auth: EnvironmentAuth
    type: DeployType = "custom"
    allow_deploy: bool = False
    cluster_name: str = ""
    mode: DeployMode = "cpu"
    dev_user: str = ""
    pool: str = ""
    router_url: str = ""
    prometheus_url: str = ""
    # Dev-adapter-only overrides; unused for type=kind/custom. Defaults are
    # derived from ``dev_user`` at the call site (see deploy_adapters/dev_adapter.py).
    image_registry: str = ""    # default "registry.example.com/project"
    argocd_branch: str = ""     # default "argocd/<dev_user>"
    exclude_tags: List[str] = dataclasses.field(default_factory=list)
    extras: Dict[str, str] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class OetfConfig:
    """Runtime config for an OETF test invocation.

    Populated via from_env() in fixture_base.setUp so every test reads the
    same OETF_* env vars supplied by the wrapper (or a direct `bazel test
    --test_env=OETF_...`).
    """
    url: str = ""
    auth_method: str = "token"       # "token" | "dev"
    auth_token: str = ""
    auth_username: str = ""
    pool: str = "default"
    client: str = "api"              # "api" | "cli" | "hybrid"
    local_osmo: str = ""             # optional explicit osmo CLI path
    data_storage_access_key_id: str = ""
    data_storage_access_key: str = ""
    data_storage_endpoint: str = ""
    data_storage_region: str = ""
    # Retained for symmetry with the old CLI; unused by the Bazel-native
    # runner (Bazel's --test_tag_filters / --test_filter handles selection).
    tags: List[str] = dataclasses.field(default_factory=list)
    exclude_tags: List[str] = dataclasses.field(default_factory=list)
    manifest_path: str = ""

    @classmethod
    def from_env(cls) -> "OetfConfig":
        """Build from OETF_* environment variables."""
        return cls(
            url=os.environ.get("OETF_URL", ""),
            auth_method=os.environ.get("OETF_AUTH_METHOD", "token"),
            auth_token=os.environ.get(
                "OETF_AUTH_TOKEN",
                os.environ.get("OSMO_ACCESS_TOKEN", ""),
            ),
            auth_username=os.environ.get("OETF_AUTH_USERNAME", ""),
            pool=os.environ.get("OETF_POOL", "default"),
            client=os.environ.get("OETF_CLIENT", "api"),
            local_osmo=os.environ.get("OETF_LOCAL_OSMO", ""),
            data_storage_access_key_id=os.environ.get("OETF_DATA_STORAGE_ACCESS_KEY_ID", ""),
            data_storage_access_key=os.environ.get("OETF_DATA_STORAGE_ACCESS_KEY", ""),
            data_storage_endpoint=os.environ.get("OETF_DATA_STORAGE_ENDPOINT", ""),
            data_storage_region=os.environ.get("OETF_DATA_STORAGE_REGION", ""),
        )
