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

import argparse
import dataclasses
import os
import pathlib
import re
import sys
from typing import Literal

import yaml

CHART_NAMES: tuple[str, ...] = (
    "service",
    "web-ui",
    "router",
    "backend-operator",
    "quick-start",
)
VERSION_YAML_RELPATH = "src/lib/utils/version.yaml"
CHARTS_RELDIR = "deployments/charts"

BumpMode = Literal["major", "minor", "patch"]


@dataclasses.dataclass(frozen=True)
class Semver:
    major: int
    minor: int
    patch: int

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

    def bump(self, mode: BumpMode) -> "Semver":
        if mode == "major":
            return Semver(self.major + 1, 0, 0)
        if mode == "minor":
            return Semver(self.major, self.minor + 1, 0)
        if mode == "patch":
            return Semver(self.major, self.minor, self.patch + 1)
        raise ValueError(f"unknown bump mode: {mode}")


def _parse_args(argv: list[str] | None) -> BumpMode:
    parser = argparse.ArgumentParser(
        prog="bump-version",
        description="Bump OSMO semver + all Helm chart versions in lockstep.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--major", dest="mode", action="store_const", const="major")
    group.add_argument("--minor", dest="mode", action="store_const", const="minor")
    group.add_argument("--patch", dest="mode", action="store_const", const="patch")
    args = parser.parse_args(argv)
    return args.mode


def _read_version_yaml(path: pathlib.Path) -> Semver:
    data = yaml.safe_load(path.read_text())
    return Semver(int(data["major"]), int(data["minor"]), int(data["revision"]))


def _read_chart(path: pathlib.Path) -> tuple[Semver, Semver]:
    """Return (chart_version, app_version) for a Chart.yaml."""
    data = yaml.safe_load(path.read_text())
    chart_version = _parse_semver(str(data["version"]))
    app_version = _parse_semver(str(data["appVersion"]))
    return chart_version, app_version


def _parse_semver(value: str) -> Semver:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", value)
    if match is None:
        raise ValueError(f"not a semver X.Y.Z: {value!r}")
    return Semver(int(match[1]), int(match[2]), int(match[3]))


def _validate_invariants(
    osmo_version: Semver,
    chart_versions: dict[str, Semver],
    app_versions: dict[str, Semver],
    quick_start_deps: dict[str, Semver],
) -> None:
    distinct_chart_versions = set(chart_versions.values())
    if len(distinct_chart_versions) != 1:
        raise SystemExit(f"chart versions disagree: {chart_versions}")
    distinct_app_versions = set(app_versions.values())
    if len(distinct_app_versions) != 1:
        raise SystemExit(f"appVersion values disagree: {app_versions}")
    (app_version,) = distinct_app_versions
    if app_version != osmo_version:
        raise SystemExit(f"appVersion {app_version} != version.yaml {osmo_version}")
    (chart_version,) = distinct_chart_versions
    for name, dep_version in quick_start_deps.items():
        if dep_version != chart_version:
            raise SystemExit(
                f"quick-start dep {name}={dep_version} != chart {chart_version}"
            )


def _read_quick_start_deps(path: pathlib.Path) -> dict[str, Semver]:
    data = yaml.safe_load(path.read_text())
    deps = data.get("dependencies") or []
    return {dep["name"]: _parse_semver(str(dep["version"])) for dep in deps}


def _rewrite_version_yaml(path: pathlib.Path, new: Semver) -> None:
    text = path.read_text()
    text = re.sub(r"(?m)^major: \d+$", f"major: {new.major}", text, count=1)
    text = re.sub(r"(?m)^minor: \d+$", f"minor: {new.minor}", text, count=1)
    text = re.sub(r"(?m)^revision: \d+$", f"revision: {new.patch}", text, count=1)
    path.write_text(text)


def _rewrite_chart(path: pathlib.Path, new_chart: Semver, new_app: Semver) -> None:
    text = path.read_text()
    text = re.sub(
        r"(?m)^version: \d+\.\d+\.\d+$",
        f"version: {new_chart}",
        text,
        count=1,
    )
    text = re.sub(
        r'(?m)^appVersion: "\d+\.\d+\.\d+"$',
        f'appVersion: "{new_app}"',
        text,
        count=1,
    )
    path.write_text(text)


def _rewrite_quick_start_deps(path: pathlib.Path, new_chart: Semver) -> None:
    text = path.read_text()
    # Inside the dependencies: block, each entry is:
    #   - name: <name>
    #     version: <X.Y.Z>
    #     repository: <...>
    # Anchor the replacement on `name:` to avoid touching the top-level version:.
    text = re.sub(
        r"(- name: [A-Za-z0-9_-]+\n  version: )\d+\.\d+\.\d+",
        lambda m: f"{m.group(1)}{new_chart}",
        text,
    )
    path.write_text(text)


def main(argv: list[str] | None = None, root: pathlib.Path | None = None) -> int:
    mode = _parse_args(argv)
    if root is None:
        workspace = os.environ.get("BUILD_WORKSPACE_DIRECTORY")
        if not workspace:
            print(
                "BUILD_WORKSPACE_DIRECTORY not set; invoke via `bazel run`.",
                file=sys.stderr,
            )
            return 1
        root = pathlib.Path(workspace)
    else:
        root = pathlib.Path(root)

    version_path = root / VERSION_YAML_RELPATH
    if not version_path.is_file():
        print(f"version.yaml not found at {version_path}", file=sys.stderr)
        return 1

    chart_paths = {
        name: root / CHARTS_RELDIR / name / "Chart.yaml" for name in CHART_NAMES
    }
    for name, path in chart_paths.items():
        if not path.is_file():
            print(f"Chart.yaml not found at {path} (chart={name})", file=sys.stderr)
            return 1

    osmo_version = _read_version_yaml(version_path)
    chart_versions = {}
    app_versions = {}
    for name, path in chart_paths.items():
        chart_v, app_v = _read_chart(path)
        chart_versions[name] = chart_v
        app_versions[name] = app_v
    quick_start_deps = _read_quick_start_deps(chart_paths["quick-start"])

    _validate_invariants(osmo_version, chart_versions, app_versions, quick_start_deps)

    new_osmo = osmo_version.bump(mode)
    (old_chart,) = set(chart_versions.values())
    new_chart = old_chart.bump(mode)

    _rewrite_version_yaml(version_path, new_osmo)
    for path in chart_paths.values():
        _rewrite_chart(path, new_chart, new_osmo)
    _rewrite_quick_start_deps(chart_paths["quick-start"], new_chart)

    # Validate by reload.
    reloaded = _read_version_yaml(version_path)
    if reloaded != new_osmo:
        print(f"post-write check failed: version.yaml is {reloaded}", file=sys.stderr)
        return 1
    for name, path in chart_paths.items():
        chart_v, app_v = _read_chart(path)
        if chart_v != new_chart:
            print(f"post-write check failed: {name} version={chart_v}", file=sys.stderr)
            return 1
        if app_v != new_osmo:
            print(
                f"post-write check failed: {name} appVersion={app_v}", file=sys.stderr
            )
            return 1
    for dep_name, dep_v in _read_quick_start_deps(chart_paths["quick-start"]).items():
        if dep_v != new_chart:
            print(f"post-write check failed: dep {dep_name}={dep_v}", file=sys.stderr)
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
