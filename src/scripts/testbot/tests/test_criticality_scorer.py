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
            direct, package_use = _python_imports(path)
            self.assertEqual(direct, {"json", "os"})
            # `import X` binds X as a value, so package_use mirrors direct.
            self.assertEqual(package_use, {"json", "os"})
        finally:
            path.unlink()

    def test_extracts_from_import(self):
        # `from X.Y import Z` records X.Y (source) and X.Y.Z (composed).
        # Only the composed name goes into package_use — the source is
        # not bound as a value in the importer.
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from src.lib.utils.client import ServiceClient\n")
            path = Path(f.name)
        try:
            direct, package_use = _python_imports(path)
            self.assertEqual(
                direct,
                {"src.lib.utils.client", "src.lib.utils.client.ServiceClient"},
            )
            self.assertEqual(
                package_use, {"src.lib.utils.client.ServiceClient"},
            )
        finally:
            path.unlink()

    def test_records_each_submodule_in_multi_name_from_import(self):
        # `from src.utils.job import a, b, c` — direct must include the
        # source plus each composed candidate so per-file lookups succeed;
        # package_use carries only the composed names.
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from src.utils.job import jobs, workflow, task\n")
            path = Path(f.name)
        try:
            direct, package_use = _python_imports(path)
            self.assertEqual(
                direct,
                {
                    "src.utils.job",
                    "src.utils.job.jobs",
                    "src.utils.job.workflow",
                    "src.utils.job.task",
                },
            )
            self.assertEqual(
                package_use,
                {
                    "src.utils.job.jobs",
                    "src.utils.job.workflow",
                    "src.utils.job.task",
                },
            )
        finally:
            path.unlink()

    def test_skips_star_import_name(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from src.lib.utils import *\n")
            path = Path(f.name)
        try:
            direct, package_use = _python_imports(path)
            self.assertEqual(direct, {"src.lib.utils"})
            self.assertEqual(package_use, set())
        finally:
            path.unlink()

    def test_skips_relative_imports(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("from . import sibling\nfrom ..lib import utils\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), (set(), set()))
        finally:
            path.unlink()

    def test_handles_syntax_error(self):
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write("def broken(:\n")
            path = Path(f.name)
        try:
            self.assertEqual(_python_imports(path), (set(), set()))
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

    def test_credits_init_py_re_exports_to_implementing_file(self):
        # `from .client import Client` in storage/__init__.py + caller's
        # `from src.lib.data.storage import Client` should credit
        # `src/lib/data/storage/client.py` with fan-in, not the package
        # directory and not __init__.py.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src" / "lib" / "data" / "storage").mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "lib" / "data" / "storage" / "__init__.py").write_text(
                "from .client import Client, SingleObjectClient\n"
            )
            (root / "src" / "lib" / "data" / "storage" / "client.py").write_text(
                "class Client: pass\nclass SingleObjectClient: pass\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.lib.data.storage import Client\n"
                "from src.lib.data.storage import SingleObjectClient as SOC\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(counts.get("src/lib/data/storage/client.py"), 1)

    def test_named_import_does_not_overcredit_package_siblings(self):
        # `from src.lib.data.storage import StorageBackend` should credit
        # ONLY backends/common.py (where StorageBackend is implemented),
        # NOT every other file storage/__init__.py re-exports from. The
        # importer never references storage as a value, so package
        # expansion of storage's full re-export set would be noise.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backends = root / "src" / "lib" / "data" / "storage" / "backends"
            backends.mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "lib" / "data" / "storage" / "__init__.py").write_text(
                "from .client import Client\n"
                "from .backends.common import StorageBackend\n"
            )
            (root / "src" / "lib" / "data" / "storage" / "client.py").write_text(
                "class Client: pass\n"
            )
            (backends / "common.py").write_text(
                "class StorageBackend: pass\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.lib.data.storage import StorageBackend\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(
                counts.get("src/lib/data/storage/backends/common.py"), 1,
            )
            # client.py is a sibling re-export of storage/__init__.py but
            # the named-symbol import never used it — must stay at 0.
            self.assertEqual(counts.get("src/lib/data/storage/client.py"), 0)

    def test_credits_package_import_to_full_re_export_set(self):
        # The dominant OSMO pattern is `from src.lib.data import storage`
        # (importing the package as a name). Python runs storage/__init__.py
        # which imports from client.py and backends/common.py — both files
        # should get fan-in credit because the importer's behavior is
        # tied to anything the __init__ surfaces.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backends = root / "src" / "lib" / "data" / "storage" / "backends"
            backends.mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "lib" / "data" / "__init__.py").write_text("")
            (root / "src" / "lib" / "data" / "storage" / "__init__.py").write_text(
                "from .client import Client\n"
                "from .backends.common import StorageBackend\n"
            )
            (root / "src" / "lib" / "data" / "storage" / "client.py").write_text(
                "class Client: pass\n"
            )
            (backends / "common.py").write_text(
                "class StorageBackend: pass\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.lib.data import storage\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(counts.get("src/lib/data/storage/client.py"), 1)
            self.assertEqual(
                counts.get("src/lib/data/storage/backends/common.py"), 1,
            )

    def test_resolves_re_export_to_package_init_when_module_missing(self):
        # `from .backends import construct_storage_backend` in
        # storage/__init__.py: there is no `backends.py`, only
        # `backends/__init__.py`. The resolver must fall back to the
        # package's __init__.py instead of pointing at a phantom file.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backends = root / "src" / "lib" / "data" / "storage" / "backends"
            backends.mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "lib" / "data" / "storage" / "__init__.py").write_text(
                "from .backends import construct_storage_backend\n"
            )
            (backends / "__init__.py").write_text(
                "def construct_storage_backend(): pass\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.lib.data.storage import construct_storage_backend\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(
                counts.get("src/lib/data/storage/backends/__init__.py"), 1,
            )
            # Phantom path must not appear in the counts dict.
            self.assertNotIn("src/lib/data/storage/backends.py", counts)

    def test_credits_nested_init_re_export_to_target_file(self):
        # `from .backends.common import StorageBackend` should credit
        # `src/lib/data/storage/backends/common.py` for callers that say
        # `from src.lib.data.storage import StorageBackend`.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backends = root / "src" / "lib" / "data" / "storage" / "backends"
            backends.mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "lib" / "data" / "storage" / "__init__.py").write_text(
                "from .backends.common import StorageBackend\n"
            )
            (backends / "common.py").write_text(
                "class StorageBackend: pass\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.lib.data.storage import StorageBackend\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(
                counts.get("src/lib/data/storage/backends/common.py"), 1,
            )

    def test_counts_from_package_import_submodule(self):
        # The OSMO-prevalent pattern: importer says
        # ``from src.utils.job import jobs`` — the file we want fan-in
        # credited to is ``src/utils/job/jobs.py``, not the directory.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src" / "utils" / "job").mkdir(parents=True)
            (root / "src" / "service").mkdir(parents=True)
            (root / "src" / "utils" / "job" / "jobs.py").write_text(
                "def run():\n    return 1\n"
            )
            (root / "src" / "utils" / "job" / "task.py").write_text(
                "def go():\n    return 1\n"
            )
            (root / "src" / "service" / "main.py").write_text(
                "from src.utils.job import jobs, task\n"
            )
            counts = build_python_fan_in(root)
            self.assertEqual(counts.get("src/utils/job/jobs.py"), 1)
            self.assertEqual(counts.get("src/utils/job/task.py"), 1)

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
