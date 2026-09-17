# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Tests for respond.py."""

import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from src.scripts.testbot import agent_runner, respond, verification
from src.scripts.testbot.respond import (
    _has_trigger,
    build_prompt,
    filter_actionable,
    sanitize_commit_message,
)


class TestHasTrigger(unittest.TestCase):
    """Tests for _has_trigger phrase matching."""

    def test_trigger_at_start_with_space(self):
        self.assertTrue(_has_trigger("/testbot fix this", "/testbot"))

    def test_trigger_at_start_with_newline(self):
        self.assertTrue(_has_trigger("/testbot\nadd more tests", "/testbot"))

    def test_trigger_at_start_end_of_string(self):
        self.assertTrue(_has_trigger("/testbot", "/testbot"))

    def test_trigger_with_leading_whitespace(self):
        self.assertTrue(_has_trigger("  /testbot fix this", "/testbot"))

    def test_trigger_with_tab_after(self):
        self.assertTrue(_has_trigger("/testbot\tfix this", "/testbot"))

    def test_no_match_mid_sentence(self):
        self.assertFalse(_has_trigger("please /testbot fix this", "/testbot"))

    def test_no_match_filename(self):
        self.assertFalse(_has_trigger("/testbot.yaml has issues", "/testbot"))

    def test_no_match_suffix(self):
        self.assertFalse(_has_trigger("/testbot-config update", "/testbot"))

    def test_no_match_case_sensitive(self):
        self.assertFalse(_has_trigger("/TESTBOT fix this", "/testbot"))

    def test_no_match_partial(self):
        self.assertFalse(_has_trigger("/test fix this", "/testbot"))

    def test_no_match_empty_body(self):
        self.assertFalse(_has_trigger("", "/testbot"))


class TestFilterActionable(unittest.TestCase):
    """Tests for filter_actionable thread filtering."""

    def _make_thread(
        self,
        is_resolved=False,
        path="src/ui/src/lib/foo.test.ts",
        comments=None,
    ):
        if comments is None:
            comments = [{
                "id": 123, "body": "/testbot fix this",
                "author": "jiaenren", "association": "MEMBER",
            }]
        return {
            "thread_id": "T_abc",
            "is_resolved": is_resolved,
            "path": path,
            "line": 10,
            "comments": comments,
        }

    def test_actionable_thread_with_trigger(self):
        threads = [self._make_thread()]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 123)

    def test_skips_resolved_thread(self):
        threads = [self._make_thread(is_resolved=True)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_with_no_comments(self):
        threads = [self._make_thread(comments=[])]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_testbot_source_path(self):
        threads = [self._make_thread(path="src/scripts/testbot/respond.py")]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_where_bot_already_replied(self):
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_actionable_after_bot_error_reply(self):
        # A bot reply bearing the error marker is non-terminal: the user's
        # /testbot stays actionable so a retry on the next event proceeds.
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200,
             "body": "I hit the max-turns limit after 201 turns.\n\n<!-- testbot-status: error -->",
             "author": "svc-osmo-ci", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 100)

    def test_skips_thread_after_bot_error_then_success(self):
        # Error → user followup → bot success: no retry
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Error.\n\n<!-- testbot-status: error -->",
             "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "/testbot retry", "author": "jiaenren", "association": "MEMBER"},
            {"id": 400, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_thread_without_trigger(self):
        comments = [{"id": 100, "body": "please fix this", "author": "jiaenren", "association": "MEMBER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_filename_false_positive(self):
        comments = [{"id": 100, "body": "/testbot.yaml has issues", "author": "jiaenren", "association": "MEMBER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_finds_trigger_in_nested_reply(self):
        comments = [
            {"id": 100, "body": "Add more tests", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "No changes needed", "author": "coderabbitai[bot]", "association": "NONE"},
            {"id": 300, "body": "/testbot remove the redundant tests", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 300)

    def test_uses_last_human_trigger_comment(self):
        comments = [
            {"id": 100, "body": "/testbot add tests", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "/testbot actually remove them", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result[0]["reply_comment_id"], 200)

    def test_skips_old_trigger_followed_by_non_trigger_human(self):
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Done.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "still failing", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_skips_non_member_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "random-user", "association": "NONE"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_allows_owner_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "org-owner", "association": "OWNER"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)

    def test_allows_collaborator_trigger(self):
        comments = [{"id": 100, "body": "/testbot fix this", "author": "collab", "association": "COLLABORATOR"}]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)

    def test_includes_full_thread_history(self):
        comments = [
            {"id": 100, "body": "Original comment", "author": "reviewer", "association": "MEMBER"},
            {"id": 200, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertIn("[reviewer]: Original comment", result[0]["thread_history"])
        self.assertIn("[jiaenren]: /testbot fix this", result[0]["thread_history"])

    def test_caps_at_max_responses(self):
        threads = [
            self._make_thread(comments=[{
                "id": i, "body": "/testbot fix", "author": "jiaenren", "association": "MEMBER",
            }])
            for i in range(5)
        ]
        result = filter_actionable(threads, "/testbot", max_responses=2)
        self.assertEqual(len(result), 2)

    def test_trigger_with_coderabbit_followup(self):
        """CodeRabbit posting after /testbot should not cause skip."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "I suggest refactoring...", "author": "coderabbitai[bot]", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 100)

    def test_trigger_handled_then_coderabbit_followup(self):
        """After bot replied, CodeRabbit followup should not re-trigger."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "I suggest refactoring...", "author": "coderabbitai[bot]", "association": "NONE"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(result, [])

    def test_new_trigger_after_bot_reply(self):
        """New /testbot after bot reply should be actionable."""
        comments = [
            {"id": 100, "body": "/testbot fix this", "author": "jiaenren", "association": "MEMBER"},
            {"id": 200, "body": "Fix applied.", "author": "svc-osmo-ci", "association": "NONE"},
            {"id": 300, "body": "/testbot try again", "author": "jiaenren", "association": "MEMBER"},
        ]
        threads = [self._make_thread(comments=comments)]
        result = filter_actionable(threads, "/testbot")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["reply_comment_id"], 300)


    def test_new_request_survives_success_for_earlier_request(self):
        comments = [
            {"id": 100, "body": "/testbot first fix", "author": "reviewer", "association": "MEMBER"},
            {"id": 200, "body": "/testbot second fix", "author": "reviewer", "association": "MEMBER"},
            {"id": 300, "body": "Quoted <!-- testbot-request: 999 -->\n\n<!-- testbot-request: 100 -->",
             "author": "svc-osmo-ci", "association": "NONE"},
        ]
        thread = self._make_thread(comments=comments)
        self.assertEqual(filter_actionable([thread], "/testbot")[0]["reply_comment_id"], 200)
        comments.append({"id": 400, "body": respond.ERROR_REPLY_MARKER,
                         "author": "svc-osmo-ci", "association": "NONE"})
        self.assertEqual(filter_actionable([thread], "/testbot")[0]["reply_comment_id"], 200)
        comments.append({"id": 500, "body": "Fixed.\n\n<!-- testbot-request: 200 -->",
                         "author": "svc-osmo-ci", "association": "NONE"})
        self.assertEqual(filter_actionable([thread], "/testbot"), [])


class TestSanitizeCommitMessage(unittest.TestCase):
    """Tests for sanitize_commit_message security filtering."""

    def test_passes_valid_message(self):
        self.assertEqual(
            sanitize_commit_message("testbot: fix edge case tests"),
            "testbot: fix edge case tests",
        )

    def test_adds_prefix_if_missing(self):
        result = sanitize_commit_message("fix edge case tests")
        self.assertTrue(result.startswith("testbot:"))

    def test_strips_signed_off_by_trailer(self):
        message = "testbot: fix tests\n\nSigned-off-by: attacker <a@evil.com>"
        result = sanitize_commit_message(message)
        self.assertNotIn("Signed-off-by:", result)

    def test_strips_co_authored_by_trailer(self):
        message = "testbot: fix tests\n\nCo-authored-by: fake <f@evil.com>"
        result = sanitize_commit_message(message)
        self.assertNotIn("Co-authored-by:", result)

    def test_caps_length(self):
        message = "testbot: " + "x" * 600
        result = sanitize_commit_message(message)
        self.assertLessEqual(len(result), 500)

    def test_preserves_multiline_body(self):
        message = "testbot: fix tests\n\nAdded edge case for empty input."
        result = sanitize_commit_message(message)
        self.assertIn("Added edge case", result)


THREAD = {"reply_comment_id": 123, "author": "reviewer", "path": "src/example.py", "line": 1,
          "thread_history": "[reviewer]: /testbot fix", "trigger_body": "/testbot fix"}


def decision() -> dict:
    """A complete response to the authorized thread."""
    return {"ready": True, "commit_message": "testbot: fix regression", "pr_body": "",
            "replies": [{"comment_id": "123", "reply": "Fixed and verified."}]}


class TestDecision(unittest.TestCase):
    """Reject incomplete or misdirected responses."""

    def test_requires_complete_decision_and_exact_requested_reply_ids(self):
        valid = decision()
        self.assertEqual(respond.validate_decision(valid, [THREAD]), valid)
        invalid: list[object] = [None, [], {}, {**valid, "extra": "field"}, {**valid, "ready": False},
                   {**valid, "ready": 1}, {**valid, "commit_message": " "},
                   {**valid, "pr_body": None}, {**valid, "replies": {}},
                   {**valid, "replies": []}, {**valid, "replies": valid["replies"] * 2}]
        invalid.extend({**valid, "replies": [reply]} for reply in (
            None, "invalid", {"comment_id": 123, "reply": "Done"},
            {"comment_id": "456", "reply": "Done"}, {"comment_id": "123", "reply": " "},
            {"comment_id": "123", "reply": "Done", "extra": True},
        ))
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                respond.validate_decision(value, [THREAD])

    def test_prompt_embeds_trusted_instructions_and_request_context(self):
        prompt = build_prompt([THREAD], 99, "Original PR description")
        instructions = (Path(respond.__file__).parent / "TESTBOT_RESPOND_PROMPT.md").read_text(encoding="utf-8")
        for text in (instructions, "PR #99", "Original PR description", "### Comment 123",
                     "`src/example.py` line 1", THREAD["thread_history"]):
            self.assertIn(text, prompt)


class TestResponseStages(unittest.TestCase):
    """Exercise verification and publication against a real local Git remote."""

    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))  # pylint: disable=consider-using-with
        self.repo, self.remote, self.artifacts = root / "repo", root / "remote.git", root / "artifacts"
        self.repo.mkdir()
        self.artifacts.mkdir()
        self.addCleanup(os.chdir, Path.cwd())
        os.chdir(self.repo)
        verification.git("init", "-qb", "testbot/respond")
        verification.git("config", "user.name", "Test")
        verification.git("config", "user.email", "test@example.com")
        Path("src").mkdir()
        Path("src/example.py").write_text("def add(a, b): return a - b\n", encoding="utf-8")
        verification.git("add", ".")
        verification.git("commit", "-qm", "baseline")
        verification.git("init", "--bare", "-q", str(self.remote))
        verification.git("remote", "add", "origin", str(self.remote))
        verification.git("push", "-q", "origin", "HEAD")
        self.head = verification.git("rev-parse", "HEAD").strip()
        self.request: dict = {"owner": "NVIDIA", "repo": "OSMO", "pr": 99, "head_sha": self.head,
                        "branch": "testbot/respond", "pr_body": "Original body", "threads": [dict(THREAD)]}
        self.metadata = {"headRefOid": self.head, "headRefName": self.request["branch"], "body": "Original body"}
        self.github = self.enterContext(patch.object(respond, "run_gh", return_value=
            subprocess.CompletedProcess([], 0, stdout=json.dumps(self.metadata), stderr="")))
        self.enterContext(patch.dict(os.environ, {"NVIDIA_API_KEY": "fixture-key",
                                                 "TESTBOT_APPLY_OUTCOME": "success"}))

    def agent_result(self, command, value=None):
        """Write the schema result produced by a successful agent."""
        output = Path(command[command.index("--output-last-message") + 1])
        output.write_text(json.dumps(value if value is not None else decision()), encoding="utf-8")
        return agent_runner.Attempt(returncode=0, successful=True)

    def verified_result(self, value=None):
        """Record a decision bound to the current worktree."""
        (self.artifacts / "result.json").write_text(
            json.dumps(value if value is not None else decision()), encoding="utf-8")
        (self.artifacts / "verified_changes.json").write_text(json.dumps({
            "verified": True, "base_commit": self.head,
            "files": verification.fingerprint(verification.changed_files()),
        }), encoding="utf-8")

    def assert_error_reply(self):
        """Failure replies must remain eligible for retry."""
        replies = [call.args[0] for call in self.github.call_args_list if "/replies " in call.args[0]]
        self.assertEqual(len(replies), 1)
        self.assertIn(respond.ERROR_REPLY_MARKER, replies[0])
        self.assertNotIn("Fixed and verified.", replies[0])

    def test_prepare_freezes_authorized_requests_and_head(self):
        raw = {"is_resolved": False, "path": "src/example.py", "line": 1, "thread_id": "T_123",
               "comments": [{"id": 123, "author": "reviewer", "association": "MEMBER",
                             "body": "/testbot fix"}]}
        request_path = self.artifacts.parent / "request.json"
        with patch.object(respond, "fetch_threads", return_value=[raw]):
            respond.prepare("NVIDIA", "OSMO", 99, "/testbot", 10, request_path)
        saved = json.loads(request_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["head_sha"], self.head)
        self.assertEqual(saved["branch"], "testbot/respond")
        self.assertEqual(saved["pr_body"], "Original body")
        self.assertEqual(saved["threads"][0]["reply_comment_id"], 123)

    def test_apply_recovers_edits_and_failed_checks_without_github_credentials(self):
        prompts = []

        def invoke(command, prompt, directory, timeout, backend, env):
            del directory, timeout
            self.assertEqual(backend, "codex")
            self.assertNotIn("--resume", command)
            self.assertEqual(env["NVIDIA_API_KEY"], "fixture-key")
            self.assertFalse({"GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY"} & env.keys())
            prompts.append(prompt)
            if len(prompts) == 1:
                Path("src/example.py").write_text("def add(a, b): return a + b\n", encoding="utf-8")
                return agent_runner.Attempt(reason="timeout", summary="interrupted")
            self.assertIn("return a + b", Path("src/example.py").read_text(encoding="utf-8"))
            return self.agent_result(command)

        with patch.dict(os.environ, {"GH_TOKEN": "secret", "GITHUB_TOKEN": "secret",
                                     "ANTHROPIC_API_KEY": "secret"}), \
                patch.object(agent_runner, "run_agent", side_effect=invoke), \
                patch.object(verification, "verify", side_effect=[RuntimeError("regression failed"), []]) as verify:
            respond.apply(self.request, self.artifacts, 3, 60)
        self.assertEqual(len(prompts), 3)
        self.assertIn("timeout: interrupted", prompts[1])
        self.assertIn("regression failed", prompts[2])
        self.assertEqual(verify.call_count, 2)
        self.assertEqual(verification.load_verified_changes(self.artifacts / "verified_changes.json"),
                         ["src/example.py"])
        self.assertTrue((self.artifacts / "attempt-1.patch").is_file())
        self.github.assert_not_called()

    def test_incomplete_results_never_verify_or_publish(self):
        for value in (None, {**decision(), "ready": False}):
            with self.subTest(value=value):
                def invoke(command, *args, result=value, **kwargs):
                    del args, kwargs
                    if result is not None:
                        return self.agent_result(command, result)
                    return agent_runner.Attempt(returncode=0, successful=True)

                with patch.object(agent_runner, "run_agent", side_effect=invoke), \
                        patch.object(verification, "verify") as verify, self.assertRaises(RuntimeError):
                    respond.apply(self.request, self.artifacts, 2, 60)
                verify.assert_not_called()
                self.assertFalse((self.artifacts / "verified_changes.json").exists())
                self.assertIn("error", json.loads((self.artifacts / "result.json").read_text(encoding="utf-8")))

    def test_agent_cannot_change_harness(self):
        def invoke(command, *args, **kwargs):
            del args, kwargs
            Path("src/scripts/testbot").mkdir(parents=True)
            Path("src/scripts/testbot/respond.py").write_text("changed", encoding="utf-8")
            return self.agent_result(command)

        with patch.object(agent_runner, "run_agent", side_effect=invoke), \
                patch.object(verification, "verify") as verify, self.assertRaises(RuntimeError):
            respond.apply(self.request, self.artifacts, 1, 60)
        verify.assert_not_called()
        self.assertFalse((self.artifacts / "verified_changes.json").exists())

    def test_failed_apply_cannot_publish_forged_success_artifacts(self):
        self.verified_result()
        with patch.dict(os.environ, {"TESTBOT_APPLY_OUTCOME": "failure"}), self.assertRaises(RuntimeError):
            respond.publish(self.request, self.artifacts)
        self.assert_error_reply()

    def test_publish_rejects_changed_content_or_remote_metadata(self):
        Path("src/example.py").write_text("reviewed\n", encoding="utf-8")
        for change in ("content", "headRefOid", "headRefName", "body"):
            with self.subTest(change=change):
                self.verified_result({**decision(), "pr_body": "Revised body"})
                self.request["threads"][0]["trigger_body"] = "/testbot update PR description"
                self.github.reset_mock()
                metadata = dict(self.metadata)
                if change == "content":
                    Path("src/example.py").write_text("tampered\n", encoding="utf-8")
                else:
                    metadata[change] = "changed remotely"
                self.github.return_value.stdout = json.dumps(metadata)
                with self.assertRaises(RuntimeError):
                    respond.publish(self.request, self.artifacts)
                self.assertEqual(verification.git("rev-parse", "HEAD").strip(), self.head)
                self.assert_error_reply()

    def test_publish_reports_only_failure_if_push_fails(self):
        Path("src/example.py").write_text("reviewed\n", encoding="utf-8")
        self.verified_result()
        with patch.object(respond, "commit_and_push", return_value=False), self.assertRaises(RuntimeError):
            respond.publish(self.request, self.artifacts)
        self.assert_error_reply()

    def test_pr_body_change_requires_authorized_request(self):
        self.verified_result({**decision(), "pr_body": "Revised body"})
        with self.assertRaises(RuntimeError):
            respond.publish(self.request, self.artifacts)
        self.assert_error_reply()
        self.assertFalse(any("--method PATCH" in call.args[0] for call in self.github.call_args_list))
        self.github.reset_mock()
        self.request["threads"][0]["trigger_body"] = "/testbot update the PR description"
        respond.publish(self.request, self.artifacts)
        calls = [shlex.split(call.args[0]) for call in self.github.call_args_list]
        self.assertTrue(any("body=Revised body" in command for command in calls))
        self.assertIn("body=Fixed and verified.\n\n<!-- testbot-request: 123 -->", calls[-1])

    def test_one_failed_reply_does_not_report_successful_work_as_failed(self):
        self.request["threads"].append({**THREAD, "reply_comment_id": 456})
        self.verified_result({**decision(), "replies": decision()["replies"] + [
            {"comment_id": "456", "reply": "Also fixed."}]})
        self.github.side_effect = [subprocess.CompletedProcess([], 0, stdout=json.dumps(self.metadata)),
                                   subprocess.CompletedProcess([], 1, stderr="reply failed"),
                                   subprocess.CompletedProcess([], 0)]
        with self.assertRaises(RuntimeError):
            respond.publish(self.request, self.artifacts)
        last_reply = self.github.call_args.args[0]
        self.assertIn("Also fixed.", last_reply)
        self.assertNotIn(respond.ERROR_REPLY_MARKER, last_reply)

    def test_reply_starting_with_at_sign_is_literal(self):
        message = "@reviewer fixed; no local file reads"
        self.assertTrue(respond.reply_to_comment("NVIDIA", "OSMO", 99, THREAD, message))
        command = shlex.split(self.github.call_args.args[0])
        self.assertIn("-f", command)
        self.assertNotIn("-F", command)
        self.assertIn("body=" + message, command)

    def test_commit_pushes_only_verified_literal_paths_to_explicit_branch(self):
        files = ["--all", ":(glob)src/*.py", "src/test_[ab].py", "src/test_*.py"]
        for name in files + ["src/unreviewed.py", "src/test_a.py"]:
            path = Path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# fixture\n", encoding="utf-8")
        verification.git("add", "src/unreviewed.py")
        verification.git("checkout", "--detach", "-q")
        self.assertTrue(respond.commit_and_push(files, "testbot: verified fixes", self.request["branch"]))
        committed = verification.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").splitlines()
        self.assertEqual(set(committed), set(files))
        remote_head = verification.git("--git-dir", str(self.remote), "rev-parse", "refs/heads/testbot/respond")
        self.assertEqual(remote_head, verification.git("rev-parse", "HEAD"))

    def test_non_fast_forward_never_rebases_verified_changes(self):
        other = self.artifacts.parent / "other"
        verification.git("clone", "-qb", self.request["branch"], str(self.remote), str(other))
        verification.git("-C", str(other), "config", "user.name", "Other")
        verification.git("-C", str(other), "config", "user.email", "other@example.com")
        verification.git("-C", str(other), "commit", "--allow-empty", "-qm", "concurrent change")
        verification.git("-C", str(other), "push", "-q")
        remote_head = verification.git("-C", str(other), "rev-parse", "HEAD")
        Path("src/example.py").write_text("reviewed\n", encoding="utf-8")
        self.assertFalse(respond.commit_and_push(["src/example.py"], "testbot: fix", self.request["branch"]))
        self.assertEqual(verification.git("rev-parse", "HEAD^1").strip(), self.head)
        self.assertEqual(verification.git("--git-dir", str(self.remote), "rev-parse", self.request["branch"]),
                         remote_head)
        self.assertFalse(Path(".git/rebase-merge").exists())


if __name__ == "__main__":
    unittest.main()
