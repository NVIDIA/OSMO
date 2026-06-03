"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import MagicMock, patch

from test_infra.oetf import aggregate


class CollectAllureResultsTest(unittest.TestCase):
    def test_collect_from_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            target_dir = os.path.join(tmp, "x", "y", "test.outputs")
            os.makedirs(target_dir)
            zip_path = os.path.join(target_dir, "outputs.zip")
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("allure-results/abc-result.json",
                            '{"uuid": "abc", "status": "passed"}')
                zf.writestr("allure-results/abc-attachment.txt", "log")

            staging = os.path.join(tmp, "staging")
            count = aggregate.collect_allure_results(
                testlogs_dir=tmp,
                targets=["//x:y"],
                staging_dir=staging,
            )
            self.assertEqual(count, 2)
            self.assertTrue(os.path.exists(
                os.path.join(staging, "abc-result.json")))
            self.assertTrue(os.path.exists(
                os.path.join(staging, "abc-attachment.txt")))

    def test_no_results_in_zip_returns_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            target_dir = os.path.join(tmp, "x", "y", "test.outputs")
            os.makedirs(target_dir)
            zip_path = os.path.join(target_dir, "outputs.zip")
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("other-stuff.txt", "ignored")
            staging = os.path.join(tmp, "staging")
            count = aggregate.collect_allure_results(
                testlogs_dir=tmp,
                targets=["//x:y"],
                staging_dir=staging,
            )
            self.assertEqual(count, 0)

    def test_collect_from_plain_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            results_dir = os.path.join(tmp, "test_infra", "oetf", "staging",
                                       "smoke", "auth-checks", "test.outputs",
                                       "allure-results")
            os.makedirs(results_dir)
            with open(os.path.join(results_dir, "abc-result.json"),
                      "w", encoding="utf-8") as fh:
                fh.write('{"uuid":"abc","status":"passed"}')
            with open(os.path.join(results_dir, "abc-attachment.txt"),
                      "w", encoding="utf-8") as fh:
                fh.write("log")
            staging = os.path.join(tmp, "staging")
            count = aggregate.collect_allure_results(
                testlogs_dir=tmp,
                targets=["//test/oetf/staging/smoke:auth-checks"],
                staging_dir=staging,
            )
            self.assertEqual(count, 2)
            self.assertTrue(os.path.exists(os.path.join(staging, "abc-result.json")))

    def test_collect_from_multiple_targets_dir_and_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Target 1: plain dir
            dir_target = os.path.join(tmp, "p1", "t1", "test.outputs",
                                      "allure-results")
            os.makedirs(dir_target)
            with open(os.path.join(dir_target, "aaa-result.json"),
                      "w", encoding="utf-8") as fh:
                fh.write('{"uuid":"aaa"}')

            # Target 2: zipped
            zip_target = os.path.join(tmp, "p2", "t2", "test.outputs")
            os.makedirs(zip_target)
            with zipfile.ZipFile(os.path.join(zip_target, "outputs.zip"), "w") as zf:
                zf.writestr("allure-results/bbb-result.json", '{"uuid":"bbb"}')

            staging = os.path.join(tmp, "staging")
            count = aggregate.collect_allure_results(
                testlogs_dir=tmp,
                targets=["//p1:t1", "//p2:t2"],
                staging_dir=staging,
            )
            self.assertEqual(count, 2)
            for fname in ("aaa-result.json", "bbb-result.json"):
                self.assertTrue(os.path.exists(os.path.join(staging, fname)))

    def test_no_targets_returns_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging = os.path.join(tmp, "staging")
            count = aggregate.collect_allure_results(
                testlogs_dir=tmp,
                targets=[],
                staging_dir=staging,
            )
            self.assertEqual(count, 0)

    def test_attaches_bazel_test_log_to_each_result(self):
        """Each Bazel target's test.log is added as a top-level
        attachment named 'test.log' on every linked result.json.
        Renders in Allure's Body tab → Attachments panel."""
        with tempfile.TemporaryDirectory() as tmp:
            target_root = os.path.join(tmp, "x", "y")
            results_dir = os.path.join(target_root, "test.outputs", "allure-results")
            os.makedirs(results_dir)
            for uid in ("aaa", "bbb"):
                with open(os.path.join(results_dir, f"{uid}-result.json"),
                          "w", encoding="utf-8") as fh:
                    json.dump({"uuid": uid, "status": "passed"}, fh)
            log_content = "INFO root:something useful\nRan 2 tests in 1.234s\nOK\n"
            with open(os.path.join(target_root, "test.log"),
                      "w", encoding="utf-8") as fh:
                fh.write(log_content)

            staging = os.path.join(tmp, "staging")
            aggregate.collect_allure_results(
                testlogs_dir=tmp, targets=["//x:y"], staging_dir=staging,
            )

            sources = []
            for uid in ("aaa", "bbb"):
                with open(os.path.join(staging, f"{uid}-result.json"),
                          encoding="utf-8") as fh:
                    data = json.load(fh)
                # No inline log content in the description anymore.
                self.assertNotIn("descriptionHtml", data)
                attachments = data.get("attachments", [])
                self.assertEqual(len(attachments), 1)
                self.assertEqual(attachments[0]["name"], "test.log")
                self.assertEqual(attachments[0]["type"], "text/plain")
                sources.append(attachments[0]["source"])
            # Same source filename across results (one log → many test methods).
            self.assertEqual(sources[0], sources[1])
            log_path = os.path.join(staging, sources[0])
            with open(log_path, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), log_content)

    def test_logs_attached_to_own_target_not_prior_targets(self):
        """Regression: when collect_allure_results processes multiple
        targets, each target's test.log must attach ONLY to its own
        result.json files — not to prior targets' results.
        """
        with tempfile.TemporaryDirectory() as tmp:
            # Target A: writes result UUID 'aaa', has test.log "A-LOG"
            a_root = os.path.join(tmp, "a", "y")
            a_results = os.path.join(a_root, "test.outputs", "allure-results")
            os.makedirs(a_results)
            with open(os.path.join(a_results, "aaa-result.json"),
                      "w", encoding="utf-8") as fh:
                json.dump({"uuid": "aaa", "status": "passed"}, fh)
            with open(os.path.join(a_root, "test.log"),
                      "w", encoding="utf-8") as fh:
                fh.write("A-LOG")

            # Target B: writes result UUID 'bbb', has test.log "B-LOG"
            b_root = os.path.join(tmp, "b", "y")
            b_results = os.path.join(b_root, "test.outputs", "allure-results")
            os.makedirs(b_results)
            with open(os.path.join(b_results, "bbb-result.json"),
                      "w", encoding="utf-8") as fh:
                json.dump({"uuid": "bbb", "status": "passed"}, fh)
            with open(os.path.join(b_root, "test.log"),
                      "w", encoding="utf-8") as fh:
                fh.write("B-LOG")

            staging = os.path.join(tmp, "staging")
            aggregate.collect_allure_results(
                testlogs_dir=tmp, targets=["//a:y", "//b:y"], staging_dir=staging,
            )

            # 'aaa' must reference A-LOG, NOT B-LOG.
            with open(os.path.join(staging, "aaa-result.json"),
                      encoding="utf-8") as fh:
                a_data = json.load(fh)
            a_attachments = a_data.get("attachments", [])
            self.assertEqual(len(a_attachments), 1)
            with open(os.path.join(staging, a_attachments[0]["source"]),
                      encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "A-LOG")

            # 'bbb' must reference B-LOG, NOT A-LOG.
            with open(os.path.join(staging, "bbb-result.json"),
                      encoding="utf-8") as fh:
                b_data = json.load(fh)
            b_attachments = b_data.get("attachments", [])
            self.assertEqual(len(b_attachments), 1)
            with open(os.path.join(staging, b_attachments[0]["source"]),
                      encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "B-LOG")

    def test_no_test_log_means_no_attachment(self):
        with tempfile.TemporaryDirectory() as tmp:
            results_dir = os.path.join(tmp, "x", "y", "test.outputs", "allure-results")
            os.makedirs(results_dir)
            with open(os.path.join(results_dir, "aaa-result.json"),
                      "w", encoding="utf-8") as fh:
                json.dump({"uuid": "aaa", "status": "passed"}, fh)
            staging = os.path.join(tmp, "staging")
            aggregate.collect_allure_results(
                testlogs_dir=tmp, targets=["//x:y"], staging_dir=staging,
            )
            with open(os.path.join(staging, "aaa-result.json"),
                      encoding="utf-8") as fh:
                data = json.load(fh)
            self.assertNotIn("descriptionHtml", data)
            self.assertEqual(data.get("attachments", []), [])


class RunAllureGenerateTest(unittest.TestCase):
    def test_invokes_allure_with_config_in_cwd(self):
        with tempfile.TemporaryDirectory() as tmp:
            staging = os.path.join(tmp, "staging")
            output = os.path.join(tmp, "report")
            history = os.path.join(tmp, "history.jsonl")
            os.makedirs(staging)

            with patch("subprocess.run") as mock_run:
                mock_run.return_value.returncode = 0
                aggregate.run_allure_generate(
                    staging_dir=staging, output_dir=output,
                    history_path=history, allure_bin="allure",
                    config_dir=tmp,
                )

            mock_run.assert_called_once()
            cmd = mock_run.call_args[0][0]
            kwargs = mock_run.call_args.kwargs
            self.assertIn("allure", cmd[0])
            self.assertIn("generate", cmd)
            self.assertIn(staging, cmd)
            # Allure 3 reads output + historyPath from allurerc.json in cwd —
            # no -o / --clean flags. Verify the config file landed there.
            self.assertEqual(kwargs.get("cwd"), tmp)
            with open(os.path.join(tmp, "allurerc.json"), encoding="utf-8") as fh:
                config = json.load(fh)
            self.assertEqual(config["output"], output)
            self.assertEqual(config["historyPath"], history)
            self.assertIn("awesome", config["plugins"])

    def test_raises_runtime_error_on_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("subprocess.run") as mock_run:
                mock_run.return_value.returncode = 1
                mock_run.return_value.stderr = "boom"
                with self.assertRaises(RuntimeError):
                    aggregate.run_allure_generate(
                        staging_dir=tmp, output_dir=tmp,
                        history_path=os.path.join(tmp, "history.jsonl"),
                        allure_bin="allure", config_dir=tmp,
                    )


class AggregateRunTest(unittest.TestCase):
    def test_writes_metadata_and_uploads(self):
        with tempfile.TemporaryDirectory() as tmp:
            sink = MagicMock()
            slash = "/"
            sink.public_url.side_effect = (
                lambda key: f"http://localhost:8080/{key.lstrip(slash)}"
            )
            with patch("test_infra.oetf.aggregate.run_allure_generate"):
                with patch("test_infra.oetf.aggregate.collect_allure_results",
                           return_value=0):
                    public_url = aggregate.run(
                        sink=sink,
                        source="users/testuser",
                        env_name="staging",
                        env_url="https://staging.example",
                        run_id="2026-04-28T22-13Z-abc1234",
                        actor="testuser",
                        targets=[],
                        testlogs_dir=tmp,
                        build_url="",
                    )
            self.assertEqual(
                public_url,
                "http://localhost:8080/users/testuser/runs/"
                "2026-04-28T22-13Z-abc1234/index.html",
            )


class WriteFailureSummaryTest(unittest.TestCase):
    def test_writes_summary_with_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Allure 3 awesome plugin writes to data/test-results/, not the
            # data/test-cases/ + data/suites.json layout Allure 2 used.
            results_dir = os.path.join(tmp, "data", "test-results")
            os.makedirs(results_dir)
            with open(os.path.join(results_dir, "abc.json"), "w",
                      encoding="utf-8") as fh:
                json.dump({
                    "id": "abc",
                    "name": "test_x",
                    "fullName": "oetf.staging.//x:test_x",
                    "status": "failed",
                    "statusDetails": {"message": "AssertionError: boom"},
                    "links": [{"type": "tms", "url": "https://osmo/wf/1",
                               "name": "Workflow"}],
                }, fh)
            url = aggregate.write_failure_summary(
                tmp, "http://localhost/runs/r1")
            self.assertTrue(url.endswith("summary.html"))
            with open(os.path.join(tmp, "summary.html"),
                      encoding="utf-8") as fh:
                html = fh.read()
            self.assertIn("test_x", html)
            self.assertIn("AssertionError: boom", html)
            self.assertIn("https://osmo/wf/1", html)
            self.assertIn(">Link</a>", html)
            # Test name is wrapped in the Allure 3 deep-link form
            # (index.html#/<id> rather than Allure 2's #suites/...).
            self.assertIn(
                '<a href="http://localhost/runs/r1/index.html#/abc">test_x</a>',
                html,
            )
            # No standalone Allure column
            self.assertNotIn("<th>Allure</th>", html)
            self.assertNotIn(">Details</a>", html)
            # Long-message wrapping: word-break/overflow-wrap is required
            # so the Reason cell doesn't overrun the Workflow column.
            self.assertIn("word-break", html)
            self.assertIn("table-layout: fixed", html)

    def test_writes_summary_no_failures(self):
        with tempfile.TemporaryDirectory() as tmp:
            results_dir = os.path.join(tmp, "data", "test-results")
            os.makedirs(results_dir)
            with open(os.path.join(results_dir, "ok.json"), "w",
                      encoding="utf-8") as fh:
                json.dump({"id": "ok1", "name": "test_ok", "status": "passed"}, fh)
            url = aggregate.write_failure_summary(tmp, "http://x")
            self.assertTrue(url.endswith("summary.html"))
            with open(os.path.join(tmp, "summary.html"),
                      encoding="utf-8") as fh:
                html = fh.read()
            self.assertIn("No failures", html)

    def test_writes_summary_no_test_cases_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = aggregate.write_failure_summary(tmp, "http://x")
            self.assertTrue(url.endswith("summary.html"))
            with open(os.path.join(tmp, "summary.html"),
                      encoding="utf-8") as fh:
                html = fh.read()
            self.assertIn("No failures", html)


if __name__ == "__main__":
    unittest.main()
