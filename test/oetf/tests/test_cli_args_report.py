"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import argparse
import unittest

from test_infra.oetf.cli_args import add_report_args


class AddReportArgsTest(unittest.TestCase):
    def test_all_flags_default_off(self):
        parser = argparse.ArgumentParser()
        add_report_args(parser)
        args = parser.parse_args([])
        # None (not "") so consumers can distinguish "not provided" from
        # "explicitly empty" — the latter is a programming error for the
        # report flags.
        self.assertIsNone(args.report_s3)
        self.assertIsNone(args.report_source)
        self.assertIsNone(args.report_actor)

    def test_explicit_values(self):
        parser = argparse.ArgumentParser()
        add_report_args(parser)
        args = parser.parse_args([
            "--report-s3", "s3://oetf-reports",
            "--report-source", "staging",
            "--report-actor", "jenkins-bot",
        ])
        self.assertEqual(args.report_s3, "s3://oetf-reports")
        self.assertEqual(args.report_source, "staging")
        self.assertEqual(args.report_actor, "jenkins-bot")
