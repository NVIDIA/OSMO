"""
Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

# Extract a one-line failure summary from a unittest stdout/stderr log.
#
# Used by `oetf:run` to show `method: ClassName: message` next to each
# `[FAIL]` target in the run summary — no useless `file://` paths.

from __future__ import annotations

import re
from typing import List, Optional, Tuple

# Matches unittest's per-failure block header, e.g.
#   "FAIL: test_pool_list (__main__.CliChecks.test_pool_list)"
_TEST_HEADER_RE = re.compile(r"^(?:FAIL|ERROR): (test_\w+) \(")

# Matches the first line unittest prints for each failure/error, e.g.
#   "AssertionError: x != y"
#   "src.lib.utils.osmo_errors.OSMOError: ..."
# Some messages span multiple lines (embedded newlines in the assertion
# string); continuation lines are captured until a block boundary.
_EXCEPTION_LINE_RE = re.compile(r"^([\w.]+(?:Error|Exception)): (.+)$")

# Lines that terminate an exception block:
#   - unittest separator (==== or ----)
#   - runner footer ("Ran N tests" / "OK" / "FAILED (")
#   - start of the next FAIL/ERROR block
_BLOCK_TERMINATOR_RE = re.compile(
    r"^(?:={5,}|-{5,}|Ran \d+ tests?\b|OK\b|FAILED \(|FAIL: |ERROR: )"
)

_MAX_CONTINUATION_LINES = 10
_MAX_RESULT_CHARS = 400


def summarize_log_path(log_path: str) -> str:
    """Open a unittest log file and return a one-line summary. '' on any error."""
    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as log_file:
            return summarize_lines(log_file.readlines())
    except OSError:
        return ""


def summarize_lines(lines: List[str]) -> str:
    """Return `{method}: {ClassName}: {message}` for the first failed test.

    If multiple tests fail in the target, append `(+N more)`. When no
    FAIL/ERROR block is present (e.g. setUp crashed before any test ran),
    fall back to the last exception line found anywhere.
    """
    failures: List[Tuple[str, str]] = []
    current_method: Optional[str] = None
    current_exception: Optional[str] = None

    i = 0
    while i < len(lines):
        raw = lines[i]
        header = _TEST_HEADER_RE.match(raw)
        if header:
            if current_method and current_exception:
                failures.append((current_method, current_exception))
            current_method = header.group(1)
            current_exception = None
            i += 1
            continue
        exc = _EXCEPTION_LINE_RE.match(raw.rstrip())
        if exc:
            class_name = exc.group(1).rsplit(".", 1)[-1]
            parts: List[str] = [exc.group(2)]
            j = i + 1
            while j < len(lines) and (j - i) <= _MAX_CONTINUATION_LINES:
                cont = lines[j].rstrip()
                if not cont or _BLOCK_TERMINATOR_RE.match(cont):
                    break
                parts.append(cont.strip())
                j += 1
            joined = " ".join(parts)
            current_exception = f"{class_name}: {joined}"
            i = j
            continue
        i += 1

    if current_method and current_exception:
        failures.append((current_method, current_exception))

    if not failures:
        if current_exception:
            return current_exception[:_MAX_RESULT_CHARS]
        return ""

    method, exc_line = failures[0]
    result = f"{method}: {exc_line}"
    if len(failures) > 1:
        result += f"  (+{len(failures) - 1} more)"
    return result[:_MAX_RESULT_CHARS]
