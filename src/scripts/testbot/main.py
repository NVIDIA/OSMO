# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""CLI entry point for the testbot."""

import argparse
import logging
import os
import sys
from datetime import datetime

from testbot.graph import build_graph
from testbot.plugins import _register_defaults
from testbot.state import TestbotState

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="Testbot — generate tests for uncovered code",
    )
    parser.add_argument("--max-targets", type=int, default=1,
                        help="Maximum number of files to target per run")
    parser.add_argument("--max-lines", type=int, default=100,
                        help="Maximum uncovered lines per target (larger files are partially covered)")
    parser.add_argument("--max-retries", type=int, default=3,
                        help="Maximum retries per target on test failure")
    parser.add_argument("--provider", default="claude",
                        choices=["nemotron", "claude"],
                        help="LLM provider for test generation")
    parser.add_argument("--dry-run", action="store_true",
                        help="Generate tests but don't create a PR")
    args = parser.parse_args()

    _register_defaults()

    graph = build_graph()

    initial_state: TestbotState = {
        "provider": args.provider,
        "targets": [],
        "current_index": 0,
        "generated_files": [],
        "last_generated": None,
        "validation_passed": False,
        "validation_output": "",
        "review_passed": False,
        "retry_count": 0,
        "max_retries": args.max_retries,
        "max_targets": args.max_targets,
        "max_lines": args.max_lines,
        "pr_url": None,
        "branch_name": f"testbot/{datetime.now().strftime('%Y%m%d-%H%M')}",  # pylint: disable=inconsistent-quotes
        "dry_run": args.dry_run,
        "errors": [],
        "codecov_token": os.getenv("CODECOV_TOKEN", ""),
    }

    logger.info("Starting testbot (provider=%s, max_targets=%d, dry_run=%s)",
                args.provider, args.max_targets, args.dry_run)

    result = graph.invoke(initial_state)

    logger.info("PR: %s", result.get("pr_url", "N/A"))
    logger.info("Files generated: %s", result.get("generated_files", []))

    if result.get("errors"):
        logger.warning("Errors encountered:")
        for error in result["errors"]:
            logger.warning("  - %s", error)

    if not result.get("generated_files"):
        logger.info("No tests generated that passed quality gate. No PR created.")
        sys.exit(0)

    if result.get("pr_url"):
        logger.info("PR created: %s", result["pr_url"])
    elif args.dry_run:
        logger.info(
            "Dry run complete. %d files would be included in PR.",
            len(result["generated_files"]),
        )


if __name__ == "__main__":
    main()
