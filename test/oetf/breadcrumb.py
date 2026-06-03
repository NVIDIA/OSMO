"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Deploy breadcrumbs at ``~/.cache/oetf/last-deploy.json``. ``oetf:teardown``
# reads this file to figure out what to destroy. The file holds a list of
# active deploys (one per env_name) so a fresh dev deploy after a kind
# deploy doesn't orphan the kind cluster.

import dataclasses
import datetime
import json
import logging
import os
from typing import Dict, List, Optional

from test_infra.oetf.models import DeployType

logger = logging.getLogger(__name__)

DEFAULT_PATH = os.path.expanduser("~/.cache/oetf/last-deploy.json")
_FORMAT_VERSION = 2


@dataclasses.dataclass
class Breadcrumb:
    """Record of an active ``oetf:deploy`` invocation."""
    type: DeployType
    env_name: str
    cluster_name: str = ""              # KIND
    deployed_at: str = ""               # ISO 8601 UTC

    @classmethod
    def now(  # pylint: disable=redefined-builtin
        cls, *, type: DeployType, env_name: str, cluster_name: str = "",
    ) -> "Breadcrumb":
        return cls(
            type=type,
            env_name=env_name,
            cluster_name=cluster_name,
            deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )


def upsert(crumb: Breadcrumb, path: Optional[str] = None) -> None:
    """Add or replace ``crumb`` in the breadcrumb file by ``env_name``.

    The replaced entry is moved to the end so ``read_all()``'s last
    element is always the most recently deployed env.
    """
    path = _resolve(path)
    deploys = [c for c in read_all(path) if c.env_name != crumb.env_name]
    deploys.append(crumb)
    _write_all(deploys, path)


def remove(env_name: str, path: Optional[str] = None) -> bool:
    """Drop the entry for ``env_name``. Returns True iff one was removed.

    Removes the file entirely once the last entry is gone so callers
    can use ``os.path.exists`` as a "any active deploy?" check.
    """
    path = _resolve(path)
    deploys = read_all(path)
    new_deploys = [c for c in deploys if c.env_name != env_name]
    if len(new_deploys) == len(deploys):
        return False
    if not new_deploys:
        clear(path)
    else:
        _write_all(new_deploys, path)
    return True


def read_all(path: Optional[str] = None) -> List[Breadcrumb]:
    """Return all active breadcrumbs (oldest first, newest last).

    Empty list if the file is missing. Auto-migrates the legacy v1
    single-dict format (``{"type": ..., "env_name": ...}``) into a
    one-element list so older breadcrumb files keep working.
    """
    path = _resolve(path)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return []
    if isinstance(data, dict) and "deploys" not in data:
        # Legacy v1 single-breadcrumb format.
        return [Breadcrumb(**data)]
    return [Breadcrumb(**entry) for entry in data.get("deploys", [])]


def find(env_name: str, path: Optional[str] = None) -> Optional[Breadcrumb]:
    for crumb in read_all(path):
        if crumb.env_name == env_name:
            return crumb
    return None


def clear(path: Optional[str] = None) -> None:
    """Remove the breadcrumb file. No-op if missing."""
    try:
        os.remove(_resolve(path))
    except FileNotFoundError:
        pass


def _resolve(path: Optional[str]) -> str:
    """Explicit path, or the module-level ``DEFAULT_PATH`` (rebindable for tests)."""
    return path if path is not None else DEFAULT_PATH


def _write_all(deploys: List[Breadcrumb], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload: Dict = {
        "version": _FORMAT_VERSION,
        "deploys": [dataclasses.asdict(c) for c in deploys],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    logger.debug("Wrote %d breadcrumb(s) to %s", len(deploys), path)
