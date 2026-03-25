# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Quality gate checks for AI-generated test files."""

import dataclasses
import logging
import re

from coverage_agent.plugins.base import detect_test_type
from coverage_agent.state import CoverageState

logger = logging.getLogger(__name__)


@dataclasses.dataclass
class QualityCheckResult:
    passed: bool
    blocking_issues: list[str]
    warnings: list[str]


# Patterns that indicate non-deterministic test code
NONDETERMINISTIC_PATTERNS = [
    r"\brandom\.",
    r"\btime\.sleep\b",
    r"\bdatetime\.now\b",
    r"\bdatetime\.utcnow\b",
]

# Python assertion patterns
PYTHON_ASSERTION_PATTERNS = [
    r"self\.assert\w+\(",
    r"self\.fail\(",
    r"with\s+self\.assertRaises\(",
]

# Go assertion patterns
GO_ASSERTION_PATTERNS = [
    r"t\.Error\w*\(",
    r"t\.Fatal\w*\(",
]

# TypeScript/Vitest assertion patterns
UI_ASSERTION_PATTERNS = [
    r"expect\(",
    r"assert\(",
]

# Generic test name patterns to warn about
GENERIC_NAME_PATTERNS = [
    r"def test_method\d+",
    r"def test_\d+",
    r"def test_it\(",
    r"func Test\d+\(",
    r'it\("test \d+',
]


def _check_has_meaningful_assertions(content: str, test_type: str) -> list[str]:
    """Check that test methods contain assertions."""
    issues = []

    if test_type == "python":
        patterns = PYTHON_ASSERTION_PATTERNS
        # Find test methods
        method_pattern = r"def (test_\w+)\(self.*?\):(.*?)(?=\n    def |\nclass |\Z)"
        methods = re.findall(method_pattern, content, re.DOTALL)

        for name, body in methods:
            has_assertion = any(re.search(p, body) for p in patterns)
            if not has_assertion:
                issues.append(f"No meaningful assertion in test method '{name}'")

    elif test_type == "go":
        patterns = GO_ASSERTION_PATTERNS
        has_any = any(re.search(p, content) for p in patterns)
        if not has_any:
            issues.append("No assertions found (t.Error/t.Fatal) in Go test file")

    elif test_type == "ui":
        patterns = UI_ASSERTION_PATTERNS
        has_any = any(re.search(p, content) for p in patterns)
        if not has_any:
            issues.append("No assertions found (expect()) in Vitest test file")

    return issues


def _check_no_private_method_calls(content: str, test_type: str) -> list[str]:
    """Check that tests don't call private/internal methods of the module under test."""
    issues = []
    if test_type == "python":
        # Match standalone underscore-prefixed identifiers imported or called directly.
        # Use word boundary \b to avoid matching substrings like format_bytes.
        private_imports = re.findall(r"from\s+\S+\s+import\s+.*?\b(_[a-z]\w+)\b", content)
        # Match calls like _helper() but NOT self._helper() (test internal helpers are OK)
        # and NOT part of longer identifiers like format_bytes()
        private_calls = re.findall(r"(?<![.\w])(_[a-z]\w+)\s*\(", content)
        # Filter out self._ style (test helper methods)
        private_calls = [c for c in private_calls if f"self.{c}" not in content]
        all_privates = set(private_imports + private_calls)
        if all_privates:
            issues.append(f"Tests call private/internal methods: {', '.join(sorted(all_privates))}")
    return issues


def _check_no_logic_in_tests(content: str, test_type: str) -> list[str]:
    """Check for loops and conditionals inside test methods."""
    issues = []
    if test_type == "python":
        method_pattern = r"def (test_\w+)\(self.*?\):(.*?)(?=\n    def |\nclass |\Z)"
        methods = re.findall(method_pattern, content, re.DOTALL)

        for name, body in methods:
            if re.search(r"\bfor\s+\w+\s+in\b", body):
                issues.append(f"Logic in test '{name}': contains a for loop")
            if re.search(r"\bwhile\s+", body):
                issues.append(f"Logic in test '{name}': contains a while loop")
            if re.search(r"\bif\s+", body):
                issues.append(f"Logic in test '{name}': contains a conditional")
    return issues


def _check_deterministic(content: str) -> list[str]:
    """Check for non-deterministic patterns."""
    issues = []
    for pattern in NONDETERMINISTIC_PATTERNS:
        matches = re.findall(pattern, content)
        if matches:
            issues.append(f"Non-deterministic code found: {matches[0]}")
    return issues


def _warn_too_many_assertions(content: str, test_type: str, threshold: int = 5) -> list[str]:
    """Warn if a test method has too many assertions (likely tests multiple behaviors)."""
    warnings = []
    if test_type == "python":
        method_pattern = r"def (test_\w+)\(self.*?\):(.*?)(?=\n    def |\nclass |\Z)"
        methods = re.findall(method_pattern, content, re.DOTALL)
        for name, body in methods:
            assertion_count = sum(len(re.findall(p, body)) for p in PYTHON_ASSERTION_PATTERNS)
            if assertion_count > threshold:
                warnings.append(
                    f"Test '{name}' has {assertion_count} assertions (>{threshold}). "
                    f"Consider splitting into multiple tests, each testing one behavior."
                )
    return warnings


def _warn_generic_names(content: str) -> list[str]:
    """Warn about generic test names like test_method1."""
    warnings = []
    for pattern in GENERIC_NAME_PATTERNS:
        matches = re.findall(pattern, content)
        if matches:
            warnings.append(
                f"Generic test name detected: '{matches[0]}'. "
                f"Use behavior-driven naming: test_[behavior]_[condition]_[expected]."
            )
    return warnings


def check_test_quality(content: str, test_type: str) -> QualityCheckResult:
    """Run all quality checks on generated test content."""
    blocking_issues = []
    warnings = []

    # Must-pass checks (block)
    blocking_issues.extend(_check_has_meaningful_assertions(content, test_type))
    blocking_issues.extend(_check_no_private_method_calls(content, test_type))
    blocking_issues.extend(_check_no_logic_in_tests(content, test_type))
    blocking_issues.extend(_check_deterministic(content))

    # Should-pass checks (warn)
    warnings.extend(_warn_too_many_assertions(content, test_type))
    warnings.extend(_warn_generic_names(content))

    return QualityCheckResult(
        passed=len(blocking_issues) == 0,
        blocking_issues=blocking_issues,
        warnings=warnings,
    )


def quality_gate(state: CoverageState) -> CoverageState:
    """LangGraph node: filter generated tests by quality checks."""
    kept_files = []
    errors = list(state.get("errors", []))

    logger.info("Quality gate: checking %d generated files", len(state["generated_files"]))

    for file_path in state["generated_files"]:
        try:
            with open(file_path, encoding="utf-8") as file:
                content = file.read()
        except FileNotFoundError:
            logger.warning("Quality gate: file not found: %s", file_path)
            errors.append(f"Quality gate: file not found: {file_path}")
            continue

        test_type = detect_test_type(file_path)
        test_type_str = test_type.value if test_type else "python"

        result = check_test_quality(content, test_type_str)

        if result.passed:
            kept_files.append(file_path)
            logger.info("Quality gate PASSED: %s", file_path)
            if result.warnings:
                for warning in result.warnings:
                    logger.info("  Warning: %s", warning)
                errors.append(f"Quality warnings for {file_path}: {'; '.join(result.warnings)}")
        else:
            for issue in result.blocking_issues:
                logger.warning("  BLOCKED: %s", issue)
            errors.append(f"Quality gate BLOCKED {file_path}: {'; '.join(result.blocking_issues)}")

    logger.info(
        "Quality gate result: %d/%d files passed",
        len(kept_files), len(state["generated_files"]),
    )
    return {**state, "generated_files": kept_files, "errors": errors}
