#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REGISTRY = "https://nvcr.io"
PYTHON_REPO = "nvidia/distroless/python"
NODE_REPO = "nvidia/distroless/node"
PYTHON_PREFIX = "3.14"
NODE_PREFIX = "24"

PYTHON_ACTIVE_RE = re.compile(
    r'(?P<indent>    )digest = "(?P<digest>sha256:[a-f0-9]+)",\n'
    r'(?P=indent)image = BASE_DISTROLESS_IMAGE_URL \+ '
    r'"(?P<image>python:3\.14-v(?P<version>[0-9]+\.[0-9]+\.[0-9]+))",'
)
PYTHON_DEV_RE = re.compile(
    r'(?P<indent>#     )digest = "(?P<digest>sha256:[a-f0-9]+)",\n'
    r'(?P=indent)image = BASE_DISTROLESS_IMAGE_URL \+ '
    r'"(?P<image>python:3\.14-v(?P<version>[0-9]+\.[0-9]+\.[0-9]+)-dev)",'
)
NODE_IMAGE_RE = re.compile(
    r"ARG NODE_DISTROLESS_IMAGE=nvcr\.io/nvidia/distroless/"
    r"node:24-v(?P<version>[0-9]+\.[0-9]+\.[0-9]+)"
)


@dataclass(frozen=True)
class DistrolessState:
    python_version: str
    python_digest: str
    python_dev_version: str
    python_dev_digest: str
    node_version: str


@dataclass(frozen=True)
class DistrolessLatest:
    python_version: str
    python_digest: str
    python_dev_digest: str
    node_version: str


def _version_tuple(version: str) -> tuple[int, int, int]:
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError(f"expected MAJOR.MINOR.PATCH, got {version!r}")
    return tuple(int(part) for part in parts)


def latest_version_for_prefix(tags: Iterable[str], prefix: str, dev: bool = False) -> str:
    suffix = "-dev" if dev else ""
    pattern = re.compile(
        rf"^{re.escape(prefix)}-v(?P<version>[0-9]+\.[0-9]+\.[0-9]+){re.escape(suffix)}$"
    )
    versions = [
        match.group("version")
        for tag in tags
        if (match := pattern.fullmatch(tag))
    ]
    if not versions:
        raise ValueError(f"no tags found for {prefix}-v*{suffix}")
    return max(versions, key=_version_tuple)


def _registry_token(repo: str) -> str:
    query = urllib.parse.urlencode({"scope": f"repository:{repo}:pull"})
    with urllib.request.urlopen(f"{REGISTRY}/proxy_auth?{query}", timeout=30) as response:
        payload = json.load(response)
    token = payload.get("token") or payload.get("access_token")
    if not token:
        raise RuntimeError(f"nvcr.io proxy_auth returned no token for {repo}")
    return token


def _registry_json(repo: str, path: str) -> dict:
    token = _registry_token(repo)
    request = urllib.request.Request(
        f"{REGISTRY}/v2/{repo}/{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def _manifest_digest(repo: str, tag: str) -> str:
    token = _registry_token(repo)
    request = urllib.request.Request(
        f"{REGISTRY}/v2/{repo}/manifests/{tag}",
        method="HEAD",
        headers={
            "Accept": "application/vnd.oci.image.index.v1+json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        digest = response.headers.get("Docker-Content-Digest")
    if not digest:
        raise RuntimeError(f"manifest digest missing for {repo}:{tag}")
    return digest


def _repo_tags(repo: str) -> list[str]:
    payload = _registry_json(repo, "tags/list")
    tags = payload.get("tags")
    if not isinstance(tags, list):
        raise RuntimeError(f"unexpected tag payload for {repo}: {payload!r}")
    return [str(tag) for tag in tags]


def fetch_latest() -> DistrolessLatest:
    python_tags = _repo_tags(PYTHON_REPO)
    node_tags = _repo_tags(NODE_REPO)

    python_version = latest_version_for_prefix(python_tags, PYTHON_PREFIX)
    python_dev_version = latest_version_for_prefix(
        python_tags,
        PYTHON_PREFIX,
        dev=True,
    )
    if python_dev_version != python_version:
        raise RuntimeError(
            "latest Python distroless dev tag does not match runtime tag: "
            f"runtime={python_version} dev={python_dev_version}"
        )

    node_version = latest_version_for_prefix(node_tags, NODE_PREFIX)

    python_tag = f"{PYTHON_PREFIX}-v{python_version}"
    python_dev_tag = f"{PYTHON_PREFIX}-v{python_version}-dev"

    return DistrolessLatest(
        python_version=python_version,
        python_digest=_manifest_digest(PYTHON_REPO, python_tag),
        python_dev_digest=_manifest_digest(PYTHON_REPO, python_dev_tag),
        node_version=node_version,
    )


def read_state(module_text: str, dockerfile_text: str) -> DistrolessState:
    python_match = PYTHON_ACTIVE_RE.search(module_text)
    if not python_match:
        raise RuntimeError("could not find active Python distroless image in MODULE.bazel")

    python_dev_match = PYTHON_DEV_RE.search(module_text)
    if not python_dev_match:
        raise RuntimeError("could not find debug Python distroless image in MODULE.bazel")

    node_match = NODE_IMAGE_RE.search(dockerfile_text)
    if not node_match:
        raise RuntimeError("could not find Node distroless image in src/ui/Dockerfile")

    return DistrolessState(
        python_version=python_match.group("version"),
        python_digest=python_match.group("digest"),
        python_dev_version=python_dev_match.group("version"),
        python_dev_digest=python_dev_match.group("digest"),
        node_version=node_match.group("version"),
    )


def update_module_text(module_text: str, latest: DistrolessLatest) -> str:
    active_replacement = (
        f'    digest = "{latest.python_digest}",\n'
        f'    image = BASE_DISTROLESS_IMAGE_URL + "python:{PYTHON_PREFIX}-v{latest.python_version}",'
    )
    module_text, active_count = PYTHON_ACTIVE_RE.subn(active_replacement, module_text, count=1)
    if active_count != 1:
        raise RuntimeError("failed to update active Python distroless image")

    dev_replacement = (
        f'#     digest = "{latest.python_dev_digest}",\n'
        f'#     image = BASE_DISTROLESS_IMAGE_URL + "python:{PYTHON_PREFIX}-v{latest.python_version}-dev",'
    )
    module_text, dev_count = PYTHON_DEV_RE.subn(dev_replacement, module_text, count=1)
    if dev_count != 1:
        raise RuntimeError("failed to update debug Python distroless image")

    return module_text


def update_dockerfile_text(dockerfile_text: str, latest: DistrolessLatest) -> str:
    replacement = (
        f"ARG NODE_DISTROLESS_IMAGE=nvcr.io/nvidia/distroless/"
        f"node:{NODE_PREFIX}-v{latest.node_version}"
    )
    dockerfile_text, count = NODE_IMAGE_RE.subn(replacement, dockerfile_text, count=1)
    if count != 1:
        raise RuntimeError("failed to update Node distroless image")
    return dockerfile_text


def label_for(latest: DistrolessLatest) -> str:
    if latest.python_version == latest.node_version:
        return f"v{latest.python_version}"
    return f"python-v{latest.python_version}-node-v{latest.node_version}"


def branch_name_for(latest: DistrolessLatest) -> str:
    safe_label = label_for(latest).replace(".", "-")
    return f"automation/update-distroless-{safe_label}"


def title_for(latest: DistrolessLatest) -> str:
    return f"Update distroless images to {label_for(latest)}"


def _write_github_output(path: str | None, values: dict[str, str]) -> None:
    if not path:
        return
    with open(path, "a", encoding="utf-8") as output:
        for key, value in values.items():
            print(f"{key}={value}", file=output)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update OSMO distroless Python and UI Node image pins.",
    )
    parser.add_argument("--apply", action="store_true", help="write file updates")
    parser.add_argument(
        "--module",
        default="MODULE.bazel",
        help="path to MODULE.bazel",
    )
    parser.add_argument(
        "--dockerfile",
        default="src/ui/Dockerfile",
        help="path to the UI Dockerfile",
    )
    parser.add_argument(
        "--github-output",
        default=os.environ.get("GITHUB_OUTPUT"),
        help="optional GitHub Actions output file",
    )
    args = parser.parse_args()

    module_path = Path(args.module)
    dockerfile_path = Path(args.dockerfile)
    module_text = module_path.read_text(encoding="utf-8")
    dockerfile_text = dockerfile_path.read_text(encoding="utf-8")

    current = read_state(module_text, dockerfile_text)
    latest = fetch_latest()

    new_module_text = update_module_text(module_text, latest)
    new_dockerfile_text = update_dockerfile_text(dockerfile_text, latest)
    updated = (
        new_module_text != module_text
        or new_dockerfile_text != dockerfile_text
    )

    if updated and args.apply:
        module_path.write_text(new_module_text, encoding="utf-8")
        dockerfile_path.write_text(new_dockerfile_text, encoding="utf-8")

    outputs = {
        "updated": str(updated).lower(),
        "branch_name": branch_name_for(latest),
        "pr_title": title_for(latest),
        "version_label": label_for(latest),
        "current_python_version": current.python_version,
        "latest_python_version": latest.python_version,
        "latest_python_digest": latest.python_digest,
        "latest_python_dev_digest": latest.python_dev_digest,
        "current_node_version": current.node_version,
        "latest_node_version": latest.node_version,
    }
    _write_github_output(args.github_output, outputs)

    print(
        "Current distroless: "
        f"python=3.14-v{current.python_version} "
        f"node=24-v{current.node_version}",
    )
    print(
        "Latest distroless: "
        f"python=3.14-v{latest.python_version} "
        f"node=24-v{latest.node_version}",
    )
    print(f"updated={str(updated).lower()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
