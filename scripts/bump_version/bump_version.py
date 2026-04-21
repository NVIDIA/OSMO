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
from typing import Callable, Literal, Union

import yaml

CHART_NAMES: tuple[str, ...] = (
    "service",
    "web-ui",
    "router",
    "backend-operator",
    "quick-start",
)
# quick-start/Chart.yaml pins exactly these four internal charts via its
# `dependencies:` block. bump_version only touches these four entries;
# any other dependency (e.g. an external chart) is left alone.
QUICK_START_DEP_NAMES: tuple[str, ...] = (
    "service",
    "web-ui",
    "router",
    "backend-operator",
)
VERSION_YAML_RELPATH = "src/lib/utils/version.yaml"
CHARTS_RELDIR = "deployments/charts"

BumpMode = Literal["major", "minor", "patch"]


@dataclasses.dataclass(frozen=True)
class Semver:
    """Semantic version X.Y.Z as three non-negative integers."""

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
    for name in QUICK_START_DEP_NAMES:
        if name not in quick_start_deps:
            raise SystemExit(f"quick-start dep {name!r} is missing")
        dep_version = quick_start_deps[name]
        if dep_version != chart_version:
            raise SystemExit(
                f"quick-start dep {name}={dep_version} != chart {chart_version}"
            )


def _read_quick_start_deps(path: pathlib.Path) -> dict[str, Semver]:
    """Return {name: version} for the internal OSMO charts in quick-start's deps.

    External dependencies (if any) are ignored — bump_version is only responsible
    for keeping the four internal entries in lockstep with the chart version.
    """
    data = yaml.safe_load(path.read_text())
    deps = data.get("dependencies") or []
    return {
        dep["name"]: _parse_semver(str(dep["version"]))
        for dep in deps
        if dep["name"] in QUICK_START_DEP_NAMES
    }


def _sub_exactly_once(
    pattern: str,
    replacement: Union[str, Callable[[re.Match[str]], str]],
    text: str,
    where: str,
) -> str:
    """Apply a single-occurrence regex substitution, failing loudly on miss."""
    new_text, count = re.subn(pattern, replacement, text, count=1)
    if count != 1:
        raise SystemExit(
            f"regex {pattern!r} matched {count} times in {where} (expected 1)"
        )
    return new_text


def _rewrite_version_yaml(path: pathlib.Path, new: Semver) -> None:
    text = path.read_text()
    text = _sub_exactly_once(
        r"(?m)^major: \d+$", f"major: {new.major}", text, str(path)
    )
    text = _sub_exactly_once(
        r"(?m)^minor: \d+$", f"minor: {new.minor}", text, str(path)
    )
    text = _sub_exactly_once(
        r"(?m)^revision: \d+$", f"revision: {new.patch}", text, str(path)
    )
    path.write_text(text)


def _rewrite_chart(path: pathlib.Path, new_chart: Semver, new_app: Semver) -> None:
    text = path.read_text()
    text = _sub_exactly_once(
        r"(?m)^version: \d+\.\d+\.\d+$",
        f"version: {new_chart}",
        text,
        str(path),
    )
    text = _sub_exactly_once(
        r'(?m)^appVersion: "\d+\.\d+\.\d+"$',
        f'appVersion: "{new_app}"',
        text,
        str(path),
    )
    path.write_text(text)


def _rewrite_quick_start_deps(path: pathlib.Path, new_chart: Semver) -> None:
    """Bump the four internal OSMO dep versions in quick-start/Chart.yaml.

    Each dep entry in the file has the structure:

        - name: <name>
          version: <X.Y.Z>
          repository: <...>

    The replacement anchors on the `- name: <exact-name>` line, so only the four
    internal chart names listed in QUICK_START_DEP_NAMES are touched. Any other
    dependency (e.g. an external chart) is left untouched.
    """
    text = path.read_text()
    for name in QUICK_START_DEP_NAMES:
        pattern = rf"(- name: {re.escape(name)}\n  version: )\d+\.\d+\.\d+"

        def _replace(match: re.Match[str]) -> str:
            return f"{match.group(1)}{new_chart}"

        text = _sub_exactly_once(pattern, _replace, text, str(path))
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
