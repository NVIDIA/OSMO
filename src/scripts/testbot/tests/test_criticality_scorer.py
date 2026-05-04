# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for criticality_scorer."""

import tempfile
import unittest
from pathlib import Path
from typing import Any

from src.scripts.testbot.criticality_scorer import (
    DEFAULT_TIER,
    Weights,
    _go_imports,
    _normalize,
    _python_imports,
    build_go_fan_in,
    build_python_fan_in,
    classify_tier,
    rank_targets,
    score_entry,
)


class TestClassifyTier(unittest.TestCase):
    """Tests for path-prefix tier classification."""

    def test_lib_is_tier_zero(self):
        self.assertEqual(classify_tier("src/lib/utils/client.py"), 0)

    def test_utils_is_tier_zero(self):
        self.assertEqual(classify_tier("src/utils/job/task.py"), 0)

    def test_runtime_pkg_is_tier_zero(self):
        self.assertEqual(classify_tier("src/runtime/pkg/data/upload.go"), 0)

    def test_service_core_is_tier_one(self):
        self.assertEqual(classify_tier("src/service/core/service.py"), 1)

    def test_cli_is_tier_two(self):
        self.assertEqual(classify_tier("src/cli/workflow.py"), 2)

    def test_runtime_cmd_is_tier_two(self):
        self.assertEqual(classify_tier("src/runtime/cmd/ctrl/main.go"), 2)

    def test_supporting_service_is_tier_three(self):
        self.assertEqual(classify_tier("src/service/router/router.py"), 3)
        self.assertEqual(classify_tier("src/service/worker/job.py"), 3)
        self.assertEqual(classify_tier("src/operator/backend_listener.py"), 3)

    def test_unknown_path_falls_through_to_default(self):
        self.assertEqual(classify_tier("src/random/path.py"), DEFAULT_TIER)


class TestNormalize(unittest.TestCase):
    """Tests for log normalization helper."""

    def test_zero_returns_zero(self):
        self.assertEqual(_normalize(0, 100), 0.0)

    def test_peak_returns_one(self):
        self.assertEqual(_normalize(100, 100), 1.0)

    def test_log_normalization_compresses_outliers(self):
        # Halfway in raw count is well above halfway in log space.
        mid = _normalize(50, 100)
        self.assertGreater(mid, 0.5)

    def test_zero_peak_returns_zero(self):
        self.assertEqual(_normalize(5, 0), 0.0)


class TestScoreEntry(unittest.TestCase):
    """Tests for the per-file scoring formula."""

    def test_high_criticality_outscores_low_at_same_coverage(self):
        weights = Weights()
        high, _ = score_entry(
            tier=0, fan_in=50, churn=20,
            coverage_pct=20.0, uncovered_lines=100,
            peak_fan_in=50, peak_churn=20, weights=weights,
        )
        low, _ = score_entry(
            tier=DEFAULT_TIER, fan_in=0, churn=0,
            coverage_pct=20.0, uncovered_lines=100,
            peak_fan_in=50, peak_churn=20, weights=weights,
        )
        self.assertGreater(high, low)

    def test_lower_coverage_increases_score(self):
        weights = Weights()
        worse, _ = score_entry(
            tier=0, fan_in=10, churn=5,
            coverage_pct=10.0, uncovered_lines=100,
            peak_fan_in=10, peak_churn=5, weights=weights,
        )
        better, _ = score_entry(
            tier=0, fan_in=10, churn=5,
            coverage_pct=80.0, uncovered_lines=100,
            peak_fan_in=10, peak_churn=5, weights=weights,
        )
        self.assertGreater(worse, better)

    def test_breakdown_sums_to_criticality(self):
        weights = Weights(tier=1.0, fan_in=1.5, churn=0.8)
        _, breakdown = score_entry(
            tier=0, fan_in=10, churn=5,
            coverage_pct=20.0, uncovered_lines=100,
            peak_fan_in=10, peak_churn=5, weights=weights,
        )
        self.assertAlmostEqual(
            breakdown["tier"] + breakdown["fan_in"] + breakdown["churn"],
            breakdown["criticality"],
            places=3,
        )

    def test_full_coverage_yields_zero_score(self):
        score, _ = score_entry(
            tier=0, fan_in=100, churn=100,
            coverage_pct=100.0, uncovered_lines=0,
            peak_fan_in=100, peak_churn=100, weights=Weights(),
        )
        self.assertEqual(score, 0.0)


class TestPythonImports(unittest.TestCase):
    """Tests for AST-based Python import extraction."""

    def test_extracts_simple_import(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("import json\nimport os\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), {"json", "os"})
        finally:
            path.unlink()

    def test_extracts_from_import(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from src.lib.utils.client import ServiceClient\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), {"src.lib.utils.client"})
        finally:
            path.unlink()

    def test_skips_relative_imports(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from . import sibling\nfrom ..lib import utils\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), set())
        finally:
            path.unlink()

    def test_handles_syntax_error(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("def broken(:\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), set())
        finally:
            path.unlink()


class TestGoImports(unittest.TestCase):
    """Tests for regex-based Go import extraction."""

    def test_extracts_block_imports(self):
        with tempfile.NamedTemporaryFile(suffix=".go", mode="w", delete=False) as f:
            f.write(
                "package main\n\n"
                "import (\n"
                "    \"fmt\"\n"
                "    \"go.corp.nvidia.com/osmo/lib/data/storage\"\n"
                ")\n"
            )
            path = Path(f.name)
        try:
            imports = _go_imports(path)
            self.assertIn("fmt", imports)
            self.assertIn("go.corp.nvidia.com/osmo/lib/data/storage", imports)
        finally:
            path.unlink()

    def test_extracts_single_line_import(self):
        with tempfile.NamedTemporaryFile(suffix=".go", mode="w", delete=False) as f:
            f.write("package main\nimport \"fmt\"\n")
            path = Path(f.name)
        try:
            self.assertEqual(_go_imports(path), {"fmt"})
        finally:
            path.unlink()


class TestBuildPythonFanIn(unittest.TestCase):
    """Tests for the Python repo-internal fan-in counter."""

    def test_counts_internal_imports_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_dir = root / "src" / "service" / "core"
            src_dir.mkdir(parents=True)
            (src_dir / "service.py").write_text(
                "from src.service.core.helpers import helper\nimport json\n"
            )
            (src_dir / "helpers.py").write_text(
                "def helper():\n    return 1\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(counts.get("src/service/core/helpers.py"), 1)
            self.assertEqual(counts.get("src/service/core/service.py"), 0)

    def test_ignores_third_party_imports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_dir = root / "src"
            src_dir.mkdir()
            (src_dir / "a.py").write_text("import requests\nimport boto3\n")
            counts = build_python_fan_in(root)
            self.assertEqual(counts.get("src/a.py", 0), 0)


class TestBuildGoFanIn(unittest.TestCase):
    """Tests for the Go repo-internal fan-in counter."""

    def test_distributes_package_fan_in_across_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src" / "lib" / "shared").mkdir(parents=True)
            (root / "src" / "cmd").mkdir(parents=True)
            (root / "src" / "lib" / "shared" / "a.go").write_text(
                "package shared\nfunc A() {}\n"
            )
            (root / "src" / "lib" / "shared" / "b.go").write_text(
                "package shared\nfunc B() {}\n"
            )
            (root / "src" / "cmd" / "main.go").write_text(
                "package main\nimport \"go.corp.nvidia.com/osmo/lib/shared\"\n"
                "func main() { shared.A() }\n"
            )
            counts = build_go_fan_in(root)
            # Package has 1 importer, 2 files -> each file gets 0
            # (integer division). At least the package path is present.
            self.assertIn("src/lib/shared/a.go", counts)


class TestRankTargets(unittest.TestCase):
    """Tests for the end-to-end ranker."""

    def test_ranks_high_criticality_above_low(self):
        report: dict[str, Any] = {
            "files": [
                {
                    "name": "src/lib/utils/critical.py",
                    "line_coverage": [[i, 1] for i in range(50)],
                },
                {
                    "name": "src/random/trivial.py",
                    "line_coverage": [[i, 1] for i in range(50)],
                },
            ]
        }
        ranked = rank_targets(
            report,
            Path("/nonexistent"),
            shortlist_size=10,
            max_uncovered=300,
            weights=Weights(),
            fan_in={"src/lib/utils/critical.py": 30, "src/random/trivial.py": 0},
            churn={"src/lib/utils/critical.py": 12, "src/random/trivial.py": 0},
        )
        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0].file_path, "src/lib/utils/critical.py")

    def test_respects_shortlist_size(self):
        report = {
            "files": [
                {
                    "name": f"src/lib/file{i}.py",
                    "line_coverage": [[j, 1] for j in range(50)],
                }
                for i in range(5)
            ]
        }
        ranked = rank_targets(
            report,
            Path("/nonexistent"),
            shortlist_size=3,
            max_uncovered=300,
            weights=Weights(),
            fan_in={},
            churn={},
        )
        self.assertEqual(len(ranked), 3)

    def test_skips_ignored_paths(self):
        report = {
            "files": [
                {
                    "name": "src/scripts/testbot/foo.py",
                    "line_coverage": [[i, 1] for i in range(50)],
                },
            ]
        }
        ranked = rank_targets(
            report,
            Path("/nonexistent"),
            shortlist_size=10,
            max_uncovered=300,
            weights=Weights(),
            fan_in={},
            churn={},
        )
        self.assertEqual(ranked, [])

    def test_skips_files_below_min_loc(self):
        report = {
            "files": [
                {
                    "name": "src/lib/tiny.py",
                    "line_coverage": [[i, 1] for i in range(10)],
                },
            ]
        }
        ranked = rank_targets(
            report,
            Path("/nonexistent"),
            shortlist_size=10,
            max_uncovered=300,
            weights=Weights(),
            fan_in={},
            churn={},
        )
        self.assertEqual(ranked, [])


if __name__ == "__main__":
    unittest.main()
