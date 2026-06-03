"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Named environment loader.
#
# Reads ``oetf.default.yaml`` from one or more paths and merges them into a
# ``Dict[str, EnvironmentConfig]``. Later paths override earlier ones per-env.
# The default order is:
#
# 1. ``test/oetf/data/oetf.default.yaml`` (canonical, shipped with the repo)
# 2. ``test/oetf/data/oetf.internal.yaml`` (optional internal-overlay,
#    sibling of oetf.default.yaml — auto-discovered when present; absent in
#    public OETF distributions)
# 3. ``~/.config/osmo/oetf.yaml`` (optional user overlay)
#
# Callers use :func:`resolve_environment` to get a single env by name.

import logging
import os
from typing import Dict, List

import yaml

from test.oetf.models import EnvironmentAuth, EnvironmentConfig

logger = logging.getLogger(__name__)

CANONICAL_PATH = os.path.join(os.path.dirname(__file__), "data", "oetf.default.yaml")
INTERNAL_OVERLAY_PATH = os.path.join(os.path.dirname(__file__), "data", "oetf.internal.yaml")
USER_OVERLAY_PATH = os.path.expanduser("~/.config/osmo/oetf.yaml")

# Overlay binaries shipped in a separate Bazel module (e.g. an internal
# overlay package consuming this OETF as @osmo_workspace) can set this env
# var to point at their own oetf.internal.yaml. Used when the overlay's
# runfiles tree is disjoint from the canonical-default discovery path.
_OVERLAY_PATH_ENV = "OETF_INTERNAL_YAML"


def default_environment_paths() -> List[str]:
    """Return the standard ordered list of environments.yaml paths.

    Merge order: canonical → internal overlay (if discovered) → user overlay.
    Later paths override earlier ones per env name.

    Internal overlay discovery, in priority order:
      1. ``OETF_INTERNAL_YAML`` env var (set by overlay shim binaries that
         ship in a separate Bazel module — used when the overlay's yaml
         lives at a runfiles path the canonical sibling-discovery can't see).
      2. ``oetf.internal.yaml`` sibling of the canonical default (used when
         the overlay ships its yaml at the same directory as the public
         default — only practical for in-repo overlays).
    """
    overlay = os.environ.get(_OVERLAY_PATH_ENV) or INTERNAL_OVERLAY_PATH
    paths = [CANONICAL_PATH]
    if os.path.isfile(overlay):
        paths.append(overlay)
    paths.append(USER_OVERLAY_PATH)
    return paths


def load_environments(paths: List[str] | None = None) -> Dict[str, EnvironmentConfig]:
    """Load and merge environment definitions from the given paths.

    Missing files are skipped silently. Later paths override earlier ones
    on a per-env-name basis. Each env is parsed into an ``EnvironmentConfig``.
    """
    if paths is None:
        paths = default_environment_paths()

    merged: Dict[str, Dict] = {}
    for path in paths:
        if not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8") as environments_file:
            raw = yaml.safe_load(environments_file) or {}
        if not isinstance(raw, dict):
            raise ValueError(
                f"{path}: top-level must be a mapping, got {type(raw).__name__}"
            )
        envs = raw.get("environments", {})
        if not isinstance(envs, dict):
            raise ValueError(f"{path}: 'environments' must be a mapping")
        for name, definition in envs.items():
            if not isinstance(definition, dict):
                raise ValueError(f"{path}: environment '{name}' must be a mapping")
            merged[name] = definition

    return {name: _parse_environment(name, raw) for name, raw in merged.items()}


def resolve_environment(
    name: str, paths: List[str] | None = None,
) -> EnvironmentConfig:
    """Load environments and return the one matching ``name``.

    Raises ``KeyError`` with the list of known env names if not found.
    """
    environments = load_environments(paths)
    if name not in environments:
        known = ", ".join(sorted(environments)) or "<none>"
        raise KeyError(
            f"Unknown environment '{name}'. Known environments: {known}"
        )
    return environments[name]


def _parse_environment(name: str, raw: Dict) -> EnvironmentConfig:
    """Parse a single env definition dict into an EnvironmentConfig."""
    url = raw.get("url", "")
    if not url:
        raise ValueError(f"environment '{name}' missing required 'url'")

    raw_auth = raw.get("auth", {})
    if not isinstance(raw_auth, dict):
        raise ValueError(f"environment '{name}': 'auth' must be a mapping")
    strategy = raw_auth.get("strategy", "")
    if strategy not in ("token", "dev"):
        raise ValueError(
            f"environment '{name}': auth.strategy must be 'token' or 'dev', "
            f"got '{strategy}'"
        )
    token_env = raw_auth.get("token_env", "")
    username = raw_auth.get("username", "")
    if strategy == "token" and not token_env:
        raise ValueError(
            f"environment '{name}': auth.strategy=token requires auth.token_env"
        )
    if strategy == "dev" and not username:
        raise ValueError(
            f"environment '{name}': auth.strategy=dev requires auth.username"
        )

    env_type = raw.get("type", "")
    if env_type not in ("kind", "dev", "custom"):
        raise ValueError(
            f"environment '{name}': 'type' must be 'kind', 'dev', or 'custom' "
            f"(got {env_type!r})"
        )

    mode = raw.get("mode", "cpu")
    if mode not in ("cpu", "gpu"):
        raise ValueError(
            f"environment '{name}': 'mode' must be 'cpu' or 'gpu' (got {mode!r})"
        )

    cluster_name = raw.get("cluster_name", "")
    dev_user = raw.get("dev_user", "")
    if env_type == "kind" and not cluster_name:
        raise ValueError(
            f"environment '{name}': type=kind requires 'cluster_name'"
        )
    if env_type == "dev" and not dev_user:
        raise ValueError(
            f"environment '{name}': type=dev requires 'dev_user'"
        )

    # allow_deploy: explicit opt-in. type=custom always pins to false.
    allow_deploy = bool(raw.get("allow_deploy", False))
    if env_type == "custom":
        allow_deploy = False

    extras = raw.get("extras", {})
    if not isinstance(extras, dict):
        raise ValueError(f"environment '{name}': 'extras' must be a mapping")

    exclude_tags = raw.get("exclude_tags", [])
    if not isinstance(exclude_tags, list):
        raise ValueError(f"environment '{name}': 'exclude_tags' must be a list")

    return EnvironmentConfig(
        name=name,
        url=url.rstrip("/"),
        auth=EnvironmentAuth(
            strategy=strategy,
            token_env=token_env,
            username=username,
        ),
        type=env_type,
        allow_deploy=allow_deploy,
        cluster_name=cluster_name,
        mode=mode,
        dev_user=dev_user,
        pool=raw.get("pool", ""),
        router_url=raw.get("router_url", "").rstrip("/"),
        prometheus_url=raw.get("prometheus_url", "").rstrip("/"),
        image_registry=raw.get("image_registry", ""),
        argocd_branch=raw.get("argocd_branch", ""),
        exclude_tags=[str(tag) for tag in exclude_tags],
        extras={str(k): str(v) for k, v in extras.items()},
    )


def resolve_token(env: EnvironmentConfig) -> str:
    """Return the token for a token-strategy env by reading its token_env var.

    Returns empty string if the env var is unset — caller is expected to
    catch this and produce a PreflightError.
    """
    if env.auth.strategy != "token":
        return ""
    return os.environ.get(env.auth.token_env, "")
