"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
import io
import re
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from test.oetf.main import maybe_publish_report

# Canonical regex matching what jenkins/vars/oetfTests.groovy _extractReportUrl
# greps for: `/Report:\s+(https?:\/\/\S+)/`. main.py emits this line so the
# Jenkins post-build step can surface the Allure run URL. If a future refactor
# accidentally renames this line, Jenkins silently loses the report link.
_JENKINS_REPORT_LINE_RE = re.compile(r"^Report:\s+(https?://\S+)$", re.MULTILINE)


def _args(**overrides):
    """Build a Namespace with all --report-* fields populated, defaulting to None.

    Mirrors the argparse defaults from cli_args.add_report_args. Tests
    pass keyword overrides for the fields they care about.
    """
    base = {
        "report_s3": None, "report_source": None, "report_actor": None,
        "report_s3_endpoint": None, "report_s3_access_key_id": None,
        "report_s3_secret_key": None, "report_s3_region": None,
        "report_public_url_base": None, "report_categories": None,
        "report_strict": False, "env": "staging",
    }
    base.update(overrides)
    return argparse.Namespace(**base)


class MaybePublishTest(unittest.TestCase):
    def test_noop_without_flag(self):
        args = _args()
        env = {"url": "https://staging.example"}
        maybe_publish_report(args, env, targets=[])

    def test_dispatches_to_users_actor_by_default(self):
        args = _args(report_s3="s3://bkt/p", report_actor="agent-x")
        env = {"url": "https://staging.example"}
        with patch("test.oetf.main.aggregate") as mock_agg, \
             patch("test.oetf.main._build_sink"):
            mock_agg.run.return_value = "https://x/users/agent-x/runs/x/index.html"
            maybe_publish_report(args, env, targets=[])
        mock_agg.run.assert_called_once()
        self.assertEqual(mock_agg.run.call_args.kwargs["source"], "users/agent-x")

    def test_explicit_source_routes_to_official(self):
        args = _args(report_s3="s3://bkt/p", report_source="staging",
                     report_actor="jenkins-bot")
        env = {"url": "https://staging.example"}
        with patch("test.oetf.main.aggregate") as mock_agg, \
             patch("test.oetf.main._build_sink"):
            mock_agg.run.return_value = "https://x/staging/runs/x/index.html"
            maybe_publish_report(args, env, targets=[])
        self.assertEqual(mock_agg.run.call_args.kwargs["source"], "staging")

    def test_strict_propagates_exceptions(self):
        args = _args(report_s3="s3://bkt/p", report_actor="x", report_strict=True)
        env = {"url": "https://staging.example"}
        with patch("test.oetf.main.aggregate") as mock_agg, \
             patch("test.oetf.main._build_sink"):
            mock_agg.run.side_effect = RuntimeError("boom")
            with self.assertRaises(RuntimeError):
                maybe_publish_report(args, env, targets=[])

    def test_non_strict_swallows_exceptions(self):
        args = _args(report_s3="s3://bkt/p", report_actor="x")
        env = {"url": "https://staging.example"}
        with patch("test.oetf.main.aggregate") as mock_agg, \
             patch("test.oetf.main._build_sink"):
            mock_agg.run.side_effect = RuntimeError("boom")
            maybe_publish_report(args, env, targets=[])  # no raise

    def test_emits_jenkins_compatible_report_line(self):
        """Guard the literal `Report: <url>` log line that Jenkins post-build
        greps for via `/Report:\\s+(https?:\\/\\/\\S+)/` (oetfTests.groovy).
        A refactor that renames this line silently breaks Jenkins's report
        link surfacing."""
        report_url = "https://reports.example.com/staging/runs/abc/index.html"
        args = _args(report_s3="s3://bkt/p", report_actor="x")
        env = {"url": "https://staging.example"}
        buf = io.StringIO()
        with patch("test.oetf.main.aggregate") as mock_agg, \
             patch("test.oetf.main._build_sink"):
            mock_agg.run.return_value = report_url
            with redirect_stdout(buf):
                maybe_publish_report(args, env, targets=[])
        output = buf.getvalue()
        match = _JENKINS_REPORT_LINE_RE.search(output)
        assert match is not None, (  # noqa: S101 — narrows type for mypy
            f"Jenkins-compatible 'Report: <url>' line not found in stdout:\n{output!r}"
        )
        self.assertEqual(match.group(1), report_url)
