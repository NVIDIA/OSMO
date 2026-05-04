# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Rank OSMO files by criticality x coverage gap.

The "select coverage targets" step in testbot used to sort files purely by
coverage percentage, which let trivial low-coverage files dominate the budget
(a one-off handler at 0% would beat a heavily-imported public API at 30%).

This module enriches each candidate with three cheap static signals:

  * **tier**       — path-prefix bucket (lib/utils > service/core > scripts)
  * **fan_in**     — repo-internal reverse imports (Python AST + Go scan)
  * **churn**      — git commits touching the file in the last 6 months

and combines them with the coverage gap into a single score so the heuristic
short-list passed to the LLM target picker is biased toward the files whose
under-coverage actually matters.

Output: JSON list of the top N candidates with a per-signal breakdown so the
LLM picker (and humans reviewing the workflow log) can see *why* each was
ranked where it was.

Usage:
    python criticality_scorer.py \
        --token $CODECOV_TOKEN \
        --repo-root . \
        --shortlist-size 20 \
        --output /tmp/shortlist.json
"""

from __future__ import annotations

import argparse
import ast
import dataclasses
import fnmatch
import json
import logging
import math
import os
import re
import subprocess
import sys
from pathlib import Path

from src.scripts.testbot.coverage_targets import (
    IGNORE_PATTERNS,
    _is_ignored,
    fetch_codecov_report,
    parse_coverage_entries,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Path-prefix tiers. Lower = more critical. Matches the AGENTS.md categorization
# (lib/ and utils/ are widely-imported foundations; service/core is the FastAPI
# core; cli + runtime are user/runtime-facing; supporting services and the
# operator land in tier 3; everything else falls through to 4).
TIER_PREFIXES: list[tuple[str, int]] = [
    ("src/lib/", 0),
    ("src/utils/", 0),
    ("src/runtime/pkg/", 0),
    ("src/service/core/", 1),
    ("src/cli/", 2),
    ("src/runtime/cmd/", 2),
    ("src/service/router/", 3),
    ("src/service/worker/", 3),
    ("src/service/agent/", 3),
    ("src/service/logger/", 3),
    ("src/service/delayed_job_monitor/", 3),
    ("src/service/authz_sidecar/", 3),
    ("src/operator/", 3),
]
DEFAULT_TIER = 4

# Files that pass _is_ignored but are still poor test targets:
# - generated barrels and trivial wrappers
# - vendored third-party code
# - docs / type-only files
EXTRA_SKIP_PATTERNS: tuple[str, ...] = (
    "src/ui/src/lib/api/generated.ts",
    "vendor/",
    "node_modules/",
)

MIN_LOC = 30

CHURN_SINCE = "6 months ago"

# Match Go imports inside the `import (...)` block (whitespace + quoted path)
# or single-line `import "fmt"` (any preceding text + quoted path).
GO_BLOCK_IMPORT_RE = re.compile(r'^\s*(?:[a-zA-Z_][\w]*\s+)?"([^"]+)"', re.MULTILINE)
GO_INLINE_IMPORT_RE = re.compile(r'"([^"]+)"')
GO_PACKAGE_PREFIX = "go.corp.nvidia.com/osmo/"


@dataclasses.dataclass(frozen=True)
class Weights:
    """Tunable weights for the criticality score.

    fan_in is weighted highest because dependency centrality is the most
    durable signal of criticality — a hub stays a hub for years, while
    coverage gaps and recent churn shift week to week. Both fan_in and
    churn are log-normalized in score_entry so the heaviest hub's
    contribution is bounded at the weight value itself.
    """
    tier: float = 1.0
    fan_in: float = 2.5
    churn: float = 0.8


@dataclasses.dataclass
class RankedTarget:
    """One file's full score breakdown for the LLM picker."""
    file_path: str
    coverage_pct: float
    uncovered_lines: int
    uncovered_ranges: list[tuple[int, int]]
    tier: int
    fan_in: int
    churn: int
    loc: int
    score: float
    score_breakdown: dict[str, float]

    def to_dict(self) -> dict:
        return dataclasses.asdict(self)


def classify_tier(file_path: str) -> int:
    """Return the criticality tier (lower = more critical) for a path."""
    for prefix, tier in TIER_PREFIXES:
        if file_path.startswith(prefix):
            return tier
    return DEFAULT_TIER


def _extra_skip(file_path: str) -> bool:
    return any(token in file_path for token in EXTRA_SKIP_PATTERNS)


def _python_module_name(path: Path, repo_root: Path) -> str:
    """Convert ``src/lib/utils/client.py`` to ``src.lib.utils.client``."""
    rel = path.relative_to(repo_root).with_suffix("")
    return ".".join(rel.parts)


def _walk_files(repo_root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    """List repo files matching any of the suffixes, excluding ignored paths."""
    results: list[Path] = []
    for path in repo_root.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        try:
            rel = str(path.relative_to(repo_root))
        except ValueError:
            continue
        if _is_ignored(rel) or _extra_skip(rel):
            continue
        results.append(path)
    return results


def _walk_init_files(repo_root: Path) -> list[Path]:
    """List ``__init__.py`` files for re-export resolution.

    Unlike ``_walk_files``, this keeps ``__init__.py`` through the filter —
    we still apply ``IGNORE_PATTERNS`` (skip tests, scripts, deployments)
    but ignore ``SKIP_BASENAME_PATTERNS`` since ``__init__.py`` is exactly
    what we want to read here.
    """
    results: list[Path] = []
    for path in repo_root.rglob("__init__.py"):
        if not path.is_file():
            continue
        rel = str(path.relative_to(repo_root))
        if any(fnmatch.fnmatch(rel, pattern) for pattern in IGNORE_PATTERNS):
            continue
        if _extra_skip(rel):
            continue
        results.append(path)
    return results


def _python_imports(path: Path) -> set[str]:
    """Return the set of dotted module names imported by a Python file.

    OSMO uses ``from src.utils.job import jobs, workflow, task`` style heavily.
    For those, we record both the source package (``src.utils.job``) and each
    imported name as a candidate submodule (``src.utils.job.jobs``,
    ``src.utils.job.workflow``, etc.). The fan-in resolver only counts the
    candidates that resolve to an actual file in the repo, so this is safe
    even when the imported name is a symbol rather than a submodule —
    ``from src.lib.utils.redact import redact_secrets`` records both
    ``src.lib.utils.redact`` (which resolves to a file) and
    ``src.lib.utils.redact.redact_secrets`` (which doesn't, so it's dropped).
    """
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError:
        return set()
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.add(node.module)
            for alias in node.names:
                if alias.name != "*":
                    modules.add(f"{node.module}.{alias.name}")
    return modules


def _re_export_targets(
    repo_root: Path,
) -> tuple[dict[str, str], dict[str, set[str]]]:
    """Parse every ``__init__.py`` for relative-import re-exports.

    Returns two maps:

    * ``aliases`` — ``<package>.<symbol>`` → implementing file, so a caller's
      ``from src.lib.data.storage import Client`` credits ``client.py``.
    * ``package_re_exports`` — ``<package>`` → set of files referenced by the
      package's ``__init__.py``. The dominant OSMO pattern is
      ``from src.lib.data import storage``: the importer pulls in the
      package as a name, Python runs ``storage/__init__.py``, and every
      file it imports from is part of the effective surface. Crediting all
      of them is more accurate than crediting nothing.
    """
    aliases: dict[str, str] = {}
    package_re_exports: dict[str, set[str]] = {}
    for init_path in _walk_init_files(repo_root):
        package_dir = init_path.parent.relative_to(repo_root)
        if str(package_dir) == ".":
            continue
        package_module = ".".join(package_dir.parts)
        try:
            tree = ast.parse(init_path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        files_in_init: set[str] = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            if node.level != 1 or not node.module:
                continue
            sub_parts = node.module.split(".")
            target_file = package_dir.joinpath(*sub_parts).with_suffix(".py")
            target_str = str(target_file).replace(os.sep, "/")
            files_in_init.add(target_str)
            for alias in node.names:
                if alias.name == "*":
                    continue
                aliases[f"{package_module}.{alias.name}"] = target_str
        if files_in_init:
            package_re_exports[package_module] = files_in_init
    return aliases, package_re_exports


def build_python_fan_in(repo_root: Path) -> dict[str, int]:
    """Walk all repo Python files and count repo-internal reverse imports.

    Returns a dict from relative file path (e.g. ``src/lib/utils/client.py``)
    to the number of *other* repo files that import that module. Imports that
    don't resolve to a file in the repo (third-party, stdlib) are dropped.

    Resolution order for each imported name:
      1. Direct submodule (``from src.utils.job import jobs`` -> ``src/utils/job/jobs.py``)
      2. ``__init__.py`` re-export alias (``from src.lib.data.storage import Client`` -> ``src/lib/data/storage/client.py``)
      3. Package re-export expansion (``from src.lib.data import storage`` ->
         credit every file that ``storage/__init__.py`` imports from)
    """
    files = _walk_files(repo_root, (".py",))
    rel_for: dict[Path, str] = {
        path: str(path.relative_to(repo_root)) for path in files
    }
    module_to_path: dict[str, str] = {
        _python_module_name(path, repo_root): rel_for[path] for path in files
    }
    aliases, package_re_exports = _re_export_targets(repo_root)
    for alias_module, alias_target in aliases.items():
        module_to_path.setdefault(alias_module, alias_target)
    counts: dict[str, int] = {p: 0 for p in module_to_path.values()}
    for path in files:
        importer_rel = rel_for[path]
        # Dedup so a file that imports both `Client` and `SingleObjectClient`
        # adds 1 to client.py, not 2 — also collapses the alias/package
        # expansion overlap.
        resolved: set[str] = set()
        for module in _python_imports(path):
            target = module_to_path.get(module)
            if target is not None and target != importer_rel:
                resolved.add(target)
            for pkg_target in package_re_exports.get(module, ()):
                if pkg_target != importer_rel:
                    resolved.add(pkg_target)
        for target in resolved:
            counts[target] = counts.get(target, 0) + 1
    return counts


def _go_package_for_file(path: Path, repo_root: Path) -> str:
    """Return ``go.corp.nvidia.com/osmo/<dir>`` for a Go source file."""
    rel = path.relative_to(repo_root).parent
    return GO_PACKAGE_PREFIX + str(rel).replace(os.sep, "/").removeprefix("src/")


def _go_imports(path: Path) -> set[str]:
    """Pull import paths out of a Go file via regex (no full parser needed)."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    in_block = False
    imports: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("import ("):
            in_block = True
            continue
        if in_block:
            if stripped == ")":
                in_block = False
                continue
            match = GO_BLOCK_IMPORT_RE.match(line)
            if match:
                imports.add(match.group(1))
        elif stripped.startswith("import "):
            match = GO_INLINE_IMPORT_RE.search(stripped)
            if match:
                imports.add(match.group(1))
    return imports


def build_go_fan_in(repo_root: Path) -> dict[str, int]:
    """Count repo-internal Go reverse package imports, distributed across files.

    A package's fan-in is shared equally across the files in that package, so
    a leaf file in a popular package gets credit for the package's imports.
    """
    files = _walk_files(repo_root, (".go",))
    package_files: dict[str, list[Path]] = {}
    package_imports: dict[str, set[str]] = {}
    for path in files:
        pkg = _go_package_for_file(path, repo_root)
        package_files.setdefault(pkg, []).append(path)
        package_imports.setdefault(pkg, set()).update(_go_imports(path))
    package_fan_in: dict[str, int] = {pkg: 0 for pkg in package_files}
    for pkg, imports in package_imports.items():
        for imp in imports:
            if imp in package_fan_in and imp != pkg:
                package_fan_in[imp] += 1
    file_fan_in: dict[str, int] = {}
    for pkg, paths in package_files.items():
        share = package_fan_in[pkg] // max(len(paths), 1)
        for path in paths:
            file_fan_in[str(path.relative_to(repo_root))] = share
    return file_fan_in


def compute_churn(
    repo_root: Path,
    since: str = CHURN_SINCE,
) -> dict[str, int]:
    """Return per-file commit count for the time window via ``git log``."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "log",
             f"--since={since}", "--pretty=format:", "--name-only"],
            capture_output=True, text=True, check=True, timeout=120,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        logger.warning("git log failed: %s; churn will be zero everywhere", exc)
        return {}
    counts: dict[str, int] = {}
    for line in result.stdout.splitlines():
        path = line.strip()
        if path:
            counts[path] = counts.get(path, 0) + 1
    return counts


def _normalize(value: int, peak: int) -> float:
    """Log-normalize so one mega-hub doesn't swamp every other signal."""
    if peak <= 0:
        return 0.0
    return math.log(value + 1) / math.log(peak + 1)


def score_entry(
    *,
    tier: int,
    fan_in: int,
    churn: int,
    coverage_pct: float,
    uncovered_lines: int,
    peak_fan_in: int,
    peak_churn: int,
    weights: Weights,
) -> tuple[float, dict[str, float]]:
    """Compute the final score and per-component breakdown."""
    tier_term = weights.tier * (DEFAULT_TIER - tier)
    fan_in_term = weights.fan_in * _normalize(fan_in, peak_fan_in)
    churn_term = weights.churn * _normalize(churn, peak_churn)
    criticality = tier_term + fan_in_term + churn_term
    gap = (1.0 - coverage_pct / 100.0) * math.log(min(uncovered_lines, 500) + 1)
    final = criticality * gap
    breakdown = {
        "tier": round(tier_term, 4),
        "fan_in": round(fan_in_term, 4),
        "churn": round(churn_term, 4),
        "criticality": round(criticality, 4),
        "gap": round(gap, 4),
    }
    return final, breakdown


def rank_targets(
    report: dict,
    repo_root: Path,
    *,
    shortlist_size: int,
    max_uncovered: int,
    weights: Weights,
    fan_in: dict[str, int] | None = None,
    churn: dict[str, int] | None = None,
) -> list[RankedTarget]:
    """Build the ranked shortlist."""
    entries = [
        entry for entry in parse_coverage_entries(report, max_uncovered)
        if not _extra_skip(entry["file_path"]) and entry["loc"] >= MIN_LOC
    ]
    if fan_in is None:
        py_fan_in = build_python_fan_in(repo_root)
        go_fan_in = build_go_fan_in(repo_root)
        fan_in = {**py_fan_in, **go_fan_in}
    if churn is None:
        churn = compute_churn(repo_root)

    peak_fan_in = max(fan_in.values(), default=0)
    peak_churn = max(churn.values(), default=0)

    ranked: list[RankedTarget] = []
    for entry in entries:
        path = entry["file_path"]
        tier = classify_tier(path)
        file_fan_in = fan_in.get(path, 0)
        file_churn = churn.get(path, 0)
        score, breakdown = score_entry(
            tier=tier,
            fan_in=file_fan_in,
            churn=file_churn,
            coverage_pct=entry["coverage_pct"],
            uncovered_lines=entry["uncovered_lines"],
            peak_fan_in=peak_fan_in,
            peak_churn=peak_churn,
            weights=weights,
        )
        ranked.append(RankedTarget(
            file_path=path,
            coverage_pct=entry["coverage_pct"],
            uncovered_lines=entry["uncovered_lines"],
            uncovered_ranges=entry["uncovered_ranges"],
            tier=tier,
            fan_in=file_fan_in,
            churn=file_churn,
            loc=entry["loc"],
            score=round(score, 4),
            score_breakdown=breakdown,
        ))
    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[:shortlist_size]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token", default="",
                        help="Codecov API token (or set CODECOV_TOKEN env var)")
    parser.add_argument("--repo-root", default=".",
                        help="Path to the OSMO repo root (default: cwd)")
    parser.add_argument("--shortlist-size", type=int, default=20)
    parser.add_argument("--max-uncovered", type=int, default=500,
                        help="Cap uncovered lines per target (0 = no cap)")
    parser.add_argument("--output", default="-",
                        help="Output path; '-' (default) writes to stdout")
    parser.add_argument("--weight-tier", type=float, default=Weights.tier)
    parser.add_argument("--weight-fan-in", type=float, default=Weights.fan_in)
    parser.add_argument("--weight-churn", type=float, default=Weights.churn)
    args = parser.parse_args()

    token = args.token or os.environ.get("CODECOV_TOKEN", "")
    if not token:
        logger.error("No Codecov token. Use --token or set CODECOV_TOKEN.")
        sys.exit(1)

    repo_root = Path(args.repo_root).resolve()
    weights = Weights(
        tier=args.weight_tier,
        fan_in=args.weight_fan_in,
        churn=args.weight_churn,
    )

    report = fetch_codecov_report(token)
    logger.info("Codecov: %d files, %.1f%% overall coverage",
                report["totals"]["files"], report["totals"]["coverage"])

    ranked = rank_targets(
        report,
        repo_root,
        shortlist_size=args.shortlist_size,
        max_uncovered=args.max_uncovered,
        weights=weights,
    )
    logger.info("Top %d shortlist:", len(ranked))
    for rank, target in enumerate(ranked, start=1):
        logger.info(
            "  %2d. score=%.2f tier=%d fan_in=%d churn=%d "
            "cov=%.1f%% uncov=%d %s",
            rank, target.score, target.tier, target.fan_in,
            target.churn, target.coverage_pct, target.uncovered_lines,
            target.file_path,
        )

    payload = json.dumps(
        [target.to_dict() for target in ranked],
        indent=2,
        default=list,
    )
    if args.output == "-":
        print(payload)
    else:
        Path(args.output).write_text(payload, encoding="utf-8")


if __name__ == "__main__":
    main()
