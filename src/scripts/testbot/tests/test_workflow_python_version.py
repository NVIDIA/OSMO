# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Guard against GitHub Actions Python pins drifting from MODULE.bazel.

If MODULE.bazel bumps Python but a workflow's actions/setup-python pin is not
updated with it, scripts using newer syntax (e.g. PEP 701 nested-quote
f-strings) fail on the workflow runner. This test catches that drift.
"""

import os
import re
import unittest
from pathlib import Path

# MODULE.bazel example: `python.toolchain(python_version = "3.14.2", ...)`.
_CANONICAL_PYTHON_RE = re.compile(
    r'python\.toolchain\([^)]*python_version\s*=\s*"([\d.]+)"',
    re.DOTALL,
)
# Workflow example: `python-version: '3.14.2'`.
_WORKFLOW_PYTHON_RE = re.compile(r"""python-version:\s*['"]([\d.]+)['"]""")


def _repo_root() -> Path:
    """Return the repo root whether running under Bazel or directly."""
    test_srcdir = os.environ.get("TEST_SRCDIR")
    if test_srcdir:
        # Bazel layout: <TEST_SRCDIR>/_main/... for bzlmod workspaces.
        return Path(test_srcdir) / "_main"
    # Direct invocation: walk up to find MODULE.bazel.
    for parent in Path(__file__).resolve().parents:
        if (parent / "MODULE.bazel").is_file():
            return parent
    raise RuntimeError("Could not locate repo root (no MODULE.bazel found).")


class TestWorkflowPythonVersion(unittest.TestCase):
    """Workflow Python pins must match MODULE.bazel's canonical version."""

    root: Path
    canonical_version: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.root = _repo_root()
        module_bazel = (cls.root / "MODULE.bazel").read_text()
        match = _CANONICAL_PYTHON_RE.search(module_bazel)
        if match is None:
            raise AssertionError(
                "Could not find python.toolchain(python_version=...) in MODULE.bazel"
            )
        cls.canonical_version = match.group(1)

    def test_all_workflows_match_canonical_python(self) -> None:
        workflows_dir = self.root / ".github" / "workflows"
        workflows = sorted(p for p in workflows_dir.iterdir() if p.suffix in {".yaml", ".yml"})
        self.assertTrue(workflows, f"No workflows found in {workflows_dir}")

        mismatches: list[tuple[str, str]] = []
        for workflow in workflows:
            for match in _WORKFLOW_PYTHON_RE.finditer(workflow.read_text()):
                pinned = match.group(1)
                if pinned != self.canonical_version:
                    mismatches.append((workflow.name, pinned))

        self.assertFalse(
            mismatches,
            msg=(
                f"Workflow Python pins must match MODULE.bazel's "
                f"{self.canonical_version}. Mismatches (workflow, pinned): {mismatches}"
            ),
        )


if __name__ == "__main__":
    unittest.main()
