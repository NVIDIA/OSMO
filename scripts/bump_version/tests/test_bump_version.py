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

import contextlib
import io
import pathlib
import shutil
import tempfile
import unittest
from typing import Any

import yaml

from scripts.bump_version import bump_version

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
CHART_NAMES = ("service", "web-ui", "router", "backend-operator", "quick-start")


def _read_yaml(path: pathlib.Path) -> dict[str, Any]:
    loaded = yaml.safe_load(path.read_text())
    if not isinstance(loaded, dict):
        raise ValueError(f"expected mapping YAML in {path}")
    return loaded


class BumpVersionTest(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, temp_dir, True)
        self.root = self._stage(pathlib.Path(temp_dir))

    def _stage(self, temp_dir: pathlib.Path) -> pathlib.Path:
        root = temp_dir / "repo"
        (root / "src/lib/utils").mkdir(parents=True)
        shutil.copy(FIXTURES / "version.yaml", root / "src/lib/utils/version.yaml")
        for name in CHART_NAMES:
            chart_dir = root / "deployments/charts" / name
            chart_dir.mkdir(parents=True)
            shutil.copy(FIXTURES / name / "Chart.yaml", chart_dir / "Chart.yaml")
        return root

    def test_minor_bump(self) -> None:
        exit_code = bump_version.main(argv=["--minor"], root=self.root)
        self.assertEqual(exit_code, 0)

        version = _read_yaml(self.root / "src/lib/utils/version.yaml")
        self.assertEqual(version["major"], 6)
        self.assertEqual(version["minor"], 4)
        self.assertEqual(version["revision"], 0)

        for name in CHART_NAMES:
            chart = _read_yaml(self.root / "deployments/charts" / name / "Chart.yaml")
            self.assertEqual(chart["version"], "1.4.0", name)
            self.assertEqual(chart["appVersion"], "6.4.0", name)

        quick_start = _read_yaml(
            self.root / "deployments/charts/quick-start/Chart.yaml"
        )
        for dependency in quick_start["dependencies"]:
            self.assertEqual(dependency["version"], "1.4.0", dependency["name"])

    def test_major_bump(self) -> None:
        exit_code = bump_version.main(argv=["--major"], root=self.root)
        self.assertEqual(exit_code, 0)

        version = _read_yaml(self.root / "src/lib/utils/version.yaml")
        self.assertEqual(
            (version["major"], version["minor"], version["revision"]), (7, 0, 0)
        )

        for name in CHART_NAMES:
            chart = _read_yaml(self.root / "deployments/charts" / name / "Chart.yaml")
            self.assertEqual(chart["version"], "2.0.0", name)
            self.assertEqual(chart["appVersion"], "7.0.0", name)

        quick_start = _read_yaml(
            self.root / "deployments/charts/quick-start/Chart.yaml"
        )
        for dependency in quick_start["dependencies"]:
            self.assertEqual(dependency["version"], "2.0.0", dependency["name"])

    def test_patch_bump(self) -> None:
        exit_code = bump_version.main(argv=["--patch"], root=self.root)
        self.assertEqual(exit_code, 0)

        version = _read_yaml(self.root / "src/lib/utils/version.yaml")
        self.assertEqual(
            (version["major"], version["minor"], version["revision"]), (6, 3, 1)
        )

        for name in CHART_NAMES:
            chart = _read_yaml(self.root / "deployments/charts" / name / "Chart.yaml")
            self.assertEqual(chart["version"], "1.3.1", name)
            self.assertEqual(chart["appVersion"], "6.3.1", name)

        quick_start = _read_yaml(
            self.root / "deployments/charts/quick-start/Chart.yaml"
        )
        for dependency in quick_start["dependencies"]:
            self.assertEqual(dependency["version"], "1.3.1", dependency["name"])

    def test_repeated_minor_bump(self) -> None:
        self.assertEqual(bump_version.main(argv=["--minor"], root=self.root), 0)
        self.assertEqual(bump_version.main(argv=["--minor"], root=self.root), 0)

        version = _read_yaml(self.root / "src/lib/utils/version.yaml")
        self.assertEqual(
            (version["major"], version["minor"], version["revision"]), (6, 5, 0)
        )

        service = _read_yaml(self.root / "deployments/charts/service/Chart.yaml")
        self.assertEqual(service["version"], "1.5.0")
        self.assertEqual(service["appVersion"], "6.5.0")

    def test_refuses_on_chart_version_drift(self) -> None:
        path = self.root / "deployments/charts/router/Chart.yaml"
        path.write_text(
            path.read_text().replace("version: 1.3.0", "version: 1.3.1", 1)
        )

        with self.assertRaisesRegex(SystemExit, "chart versions disagree"):
            bump_version.main(argv=["--minor"], root=self.root)

    def test_refuses_on_app_version_drift(self) -> None:
        path = self.root / "deployments/charts/web-ui/Chart.yaml"
        path.write_text(
            path.read_text().replace('appVersion: "6.3.0"', 'appVersion: "6.4.0"', 1)
        )

        with self.assertRaisesRegex(SystemExit, "appVersion"):
            bump_version.main(argv=["--minor"], root=self.root)

    def test_refuses_on_quick_start_dep_drift(self) -> None:
        path = self.root / "deployments/charts/quick-start/Chart.yaml"
        path.write_text(
            path.read_text().replace("  version: 1.3.0", "  version: 1.2.9", 1)
        )

        with self.assertRaisesRegex(SystemExit, "quick-start dep"):
            bump_version.main(argv=["--minor"], root=self.root)

    def test_missing_version_yaml(self) -> None:
        (self.root / "src/lib/utils/version.yaml").unlink()

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = bump_version.main(argv=["--minor"], root=self.root)

        self.assertEqual(exit_code, 1)
        self.assertIn("version.yaml not found", stderr.getvalue())

    def test_no_flag_is_error(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as context:
                bump_version.main(argv=[], root=self.root)
        self.assertEqual(context.exception.code, 2)

    def test_two_flags_is_error(self) -> None:
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as context:
                bump_version.main(argv=["--minor", "--patch"], root=self.root)
        self.assertEqual(context.exception.code, 2)

    def test_comments_preserved(self) -> None:
        paths = [
            self.root / "src/lib/utils/version.yaml",
            *(
                self.root / "deployments/charts" / name / "Chart.yaml"
                for name in CHART_NAMES
            ),
        ]
        before = {path: path.read_text() for path in paths}

        self.assertEqual(bump_version.main(argv=["--minor"], root=self.root), 0)

        def non_version_lines(text: str) -> list[str]:
            keep = []
            for line in text.splitlines():
                stripped = line.lstrip()
                if stripped.startswith(
                    ("major:", "minor:", "revision:", "version:", "appVersion:")
                ):
                    continue
                keep.append(line)
            return keep

        for path, original in before.items():
            new = path.read_text()
            self.assertEqual(
                non_version_lines(new), non_version_lines(original), str(path)
            )


if __name__ == "__main__":
    unittest.main()
