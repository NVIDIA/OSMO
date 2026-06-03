"""
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
"""

import datetime
import json
import os
import tempfile
import unittest

from test.oetf import reporter


class StatusMappingTest(unittest.TestCase):
    def test_passed_maps_to_passed(self):
        self.assertEqual(
            reporter.map_status(reporter.TestStatus.PASSED), "passed")

    def test_failure_maps_to_failed(self):
        self.assertEqual(
            reporter.map_status(reporter.TestStatus.FAILURE), "failed")

    def test_error_maps_to_broken(self):
        self.assertEqual(
            reporter.map_status(reporter.TestStatus.ERROR), "broken")

    def test_skipped_maps_to_skipped(self):
        self.assertEqual(
            reporter.map_status(reporter.TestStatus.SKIPPED), "skipped")


class ResultJsonTest(unittest.TestCase):
    def test_minimal_passed(self):
        result = reporter.build_result(
            env_name="staging",
            target="//x:test_y",
            test_name="test_y",
            unittest_status=reporter.TestStatus.PASSED,
            start_ms=1_700_000_000_000,
            stop_ms=1_700_000_001_500,
            parameters={"pool": "cpu-pool"},
            tags=["smoke", "auth"],
            steps=[],
            attachments=[],
            actor="testuser",
        )
        self.assertEqual(result["name"], "test_y")
        self.assertEqual(result["fullName"], "oetf.staging.//x:test_y")
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["start"], 1_700_000_000_000)
        self.assertEqual(result["stop"], 1_700_000_001_500)
        self.assertIn({"name": "tag", "value": "smoke"}, result["labels"])
        self.assertIn({"name": "tag", "value": "auth"}, result["labels"])
        self.assertIn({"name": "epic", "value": "staging"}, result["labels"])
        self.assertIn({"name": "owner", "value": "testuser"}, result["labels"])
        self.assertIn({"name": "pool", "value": "cpu-pool"}, result["parameters"])

    def test_failed_carries_status_details(self):
        result = reporter.build_result(
            env_name="staging",
            target="//x:test_y",
            test_name="test_y",
            unittest_status=reporter.TestStatus.FAILURE,
            start_ms=0, stop_ms=1,
            parameters={},
            tags=[],
            steps=[],
            attachments=[],
            actor="testuser",
            message="AssertionError: 200 != 500",
            trace="Traceback...",
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["statusDetails"]["message"],
                         "AssertionError: 200 != 500")
        self.assertEqual(result["statusDetails"]["trace"], "Traceback...")

    def test_severity_smoke_critical(self):
        result = reporter.build_result(
            env_name="staging", target="//x:test_y", test_name="test_y",
            unittest_status=reporter.TestStatus.PASSED, start_ms=0, stop_ms=1,
            parameters={}, tags=["smoke"], steps=[], attachments=[],
            actor="testuser",
        )
        self.assertIn({"name": "severity", "value": "critical"}, result["labels"])

    def test_severity_non_smoke_normal(self):
        result = reporter.build_result(
            env_name="staging", target="//x:test_y", test_name="test_y",
            unittest_status=reporter.TestStatus.PASSED, start_ms=0, stop_ms=1,
            parameters={}, tags=["scenario"], steps=[], attachments=[],
            actor="testuser",
        )
        self.assertIn({"name": "severity", "value": "normal"}, result["labels"])

    def test_volatile_params_marked_excluded(self):
        # Allure 3 recomputes historyId as <testCase.id>.<md5(params)>
        # ignoring our explicit historyId field. For trend history to
        # match across runs, per-run-volatile params (workflow URL)
        # MUST carry `excluded: True` so Allure's stringifyParams skips
        # them in the md5 input. Stable params (pool) stay un-excluded.
        result = reporter.build_result(
            env_name="staging", target="//x:test_y", test_name="test_y",
            unittest_status=reporter.TestStatus.PASSED, start_ms=0, stop_ms=1,
            parameters={
                "pool": "cpu-pool",
                "workflow": "https://staging.osmo/workflows/wf-abc",
            },
            tags=[], steps=[], attachments=[], actor="testuser",
        )
        params_by_name = {p["name"]: p for p in result["parameters"]}
        self.assertEqual(params_by_name["workflow"].get("excluded"), True)
        self.assertNotIn("excluded", params_by_name["pool"])


class RecorderTest(unittest.TestCase):
    def test_record_step_appends(self):
        recorder = reporter.Recorder()
        recorder.record_step(
            name="GET /health", status=reporter.StepStatus.PASSED,
            start_ms=0, stop_ms=10,
        )
        self.assertEqual(len(recorder.steps), 1)
        self.assertEqual(recorder.steps[0]["name"], "GET /health")
        self.assertEqual(recorder.steps[0]["status"], "passed")
        self.assertEqual(recorder.steps[0]["stage"], "finished")
        self.assertEqual(recorder.steps[0]["start"], 0)
        self.assertEqual(recorder.steps[0]["stop"], 10)

    def test_record_attachment_writes_file(self):
        recorder = reporter.Recorder()
        with tempfile.TemporaryDirectory() as tmp:
            recorder.set_outputs_dir(tmp)
            recorder.record_attachment("response.json", "application/json",
                                       b'{"ok": true}')
            self.assertEqual(len(recorder.attachments), 1)
            attach = recorder.attachments[0]
            self.assertEqual(attach["name"], "response.json")
            self.assertEqual(attach["type"], "application/json")
            with open(os.path.join(tmp, attach["source"]), "rb") as fh:
                written = fh.read()
            self.assertEqual(written, b'{"ok": true}')

    def test_record_attachment_no_op_without_dir(self):
        recorder = reporter.Recorder()
        recorder.record_attachment("x.txt", "text/plain", b"abc")
        self.assertEqual(recorder.attachments, [])


class MetadataBuildersTest(unittest.TestCase):
    def test_build_executor(self):
        executor = reporter.build_executor(
            run_id="2026-04-28T22-13Z-a79176b",
            env_name="staging",
            build_url="https://jenkins/example/123",
            report_url_base="https://reports.example.com",
            source="staging",
            start_epoch=1_777_000_000,
        )
        self.assertEqual(executor["name"], "OETF")
        self.assertEqual(executor["type"], "custom")
        self.assertEqual(executor["buildOrder"], 1_777_000_000)
        self.assertEqual(executor["buildName"], "2026-04-28T22-13Z-a79176b")
        self.assertEqual(executor["buildUrl"], "https://jenkins/example/123")
        self.assertEqual(executor["reportName"], "OETF staging @ 2026-04-28T22-13Z-a79176b")
        self.assertTrue(executor["reportUrl"].endswith(
            "/staging/runs/2026-04-28T22-13Z-a79176b/index.html"))

    def test_build_environment_props(self):
        text = reporter.build_environment_properties({
            "OSMO.URL": "https://staging.example",
            "OETF.Env": "staging",
            "Git.SHA": "a79176b",
        })
        self.assertIn("OSMO.URL = https://staging.example", text)
        self.assertIn("OETF.Env = staging", text)
        self.assertIn("Git.SHA = a79176b", text)

    def test_compute_run_id_utc_aware(self):
        now = datetime.datetime(2026, 4, 28, 22, 13, 0,
                                tzinfo=datetime.timezone.utc)
        rid = reporter.compute_run_id(now=now, git_sha="a79176bdc")
        self.assertEqual(rid, "2026-04-28T22-13Z-a79176b")

    def test_compute_run_id_naive_datetime_assumed_utc(self):
        """Naive datetime is treated as UTC — defensive for callers that
        forget tzinfo."""
        now = datetime.datetime(2026, 4, 28, 22, 13, 0)
        rid = reporter.compute_run_id(now=now, git_sha="abc1234")
        self.assertEqual(rid, "2026-04-28T22-13Z-abc1234")

    def test_compute_run_id_no_git_sha_uses_sentinel(self):
        """When git isn't available, callers pass None and we fall back
        to a non-hex sentinel so the slug can never collide with a real
        7-char short SHA."""
        now = datetime.datetime(2026, 4, 28, 22, 13, 0,
                                tzinfo=datetime.timezone.utc)
        self.assertEqual(
            reporter.compute_run_id(now=now, git_sha=None),
            "2026-04-28T22-13Z-XXXXXXX")
        self.assertEqual(
            reporter.compute_run_id(now=now, git_sha=""),
            "2026-04-28T22-13Z-XXXXXXX")


class LinksTest(unittest.TestCase):
    def test_record_link_appends(self):
        recorder = reporter.Recorder()
        recorder.record_link("Workflow", "https://staging.osmo/workflow/foo", "tms")
        self.assertEqual(len(recorder.links), 1)
        self.assertEqual(recorder.links[0]["name"], "Workflow")
        self.assertEqual(recorder.links[0]["url"], "https://staging.osmo/workflow/foo")
        self.assertEqual(recorder.links[0]["type"], "tms")

    def test_build_result_carries_links(self):
        result = reporter.build_result(
            env_name="staging", target="//x:test_y", test_name="test_y",
            unittest_status=reporter.TestStatus.PASSED, start_ms=0, stop_ms=1,
            parameters={}, tags=[], steps=[], attachments=[],
            links=[{"name": "Workflow", "url": "https://x", "type": "tms"}],
            actor="testuser",
        )
        self.assertEqual(len(result["links"]), 1)
        self.assertEqual(result["links"][0]["url"], "https://x")


class WriteResultTest(unittest.TestCase):
    def test_writes_uuid_named_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            recorder = reporter.Recorder()
            recorder.set_outputs_dir(tmp)
            recorder.record_step("step1", reporter.StepStatus.PASSED, 0, 1)
            uuid = reporter.write_result(
                outputs_dir=tmp,
                recorder=recorder,
                env_name="staging",
                target="//foo:test_bar",
                test_name="test_bar",
                unittest_status=reporter.TestStatus.PASSED,
                start_ms=0, stop_ms=10,
                parameters={"pool": "cpu-pool"},
                tags=["smoke"],
                actor="testuser",
            )
            self.assertRegex(uuid, r"^[0-9a-f-]{36}$")
            path = os.path.join(tmp, f"{uuid}-result.json")
            with open(path, encoding="utf-8") as fh:
                payload = json.load(fh)
            self.assertEqual(payload["uuid"], uuid)
            self.assertEqual(payload["status"], "passed")
            self.assertEqual(len(payload["steps"]), 1)
            self.assertEqual(payload["steps"][0]["name"], "step1")


if __name__ == "__main__":
    unittest.main()
