# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long
# SPDX-License-Identifier: Apache-2.0
"""Regression coverage for agent failure recovery and independent review gates."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

from src.scripts.testbot import agent_runner, pipeline, run_summary, verification


class TestAgentProcess(unittest.TestCase):
    """Exercise real subprocess streaming, not only mocked result dictionaries."""

    def run_script(self, script: str, backend: str = 'claude', timeout: float = 5):
        """Run a fake CLI in a disposable directory."""
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))  # pylint: disable=consider-using-with
        return agent_runner.run_agent([sys.executable, '-c', script], 'test prompt',
                                      directory, timeout, backend), directory

    def test_success_subtype_with_is_error_is_failure(self):
        result, directory = self.run_script(
            'import json; print(json.dumps({"type":"result","subtype":"success",'
            '"is_error":True,"terminal_reason":"blocking_limit",'
            '"num_turns":78,"result":"Prompt is too long"}))')
        self.assertFalse(result.successful)
        self.assertEqual(result.reason, 'blocking_limit')
        self.assertEqual(result.turns, 78)
        self.assertTrue(result.recoverable)
        self.assertTrue((directory / 'stream.jsonl').exists())

    def test_clean_exit_without_result_does_not_pass(self):
        result, _ = self.run_script('print("no terminal event")')
        self.assertFalse(result.successful)
        self.assertEqual(result.returncode, 0)

    def test_compaction_failure_stops_hung_process_and_keeps_diagnostics(self):
        result, directory = self.run_script(
            'import json, signal; print(json.dumps({"type":"system",'
            '"compact_result":"failed","compact_error":"output limit 20000"}),'
            'flush=True); signal.pause()')
        self.assertEqual(result.reason, 'compaction_failed')
        self.assertEqual(result.compaction_failures, 1)
        self.assertFalse(result.successful)
        self.assertIn('output limit 20000', (directory / 'result.json').read_text(encoding='utf-8'))

    def test_timeout_stops_silent_process(self):
        result, _ = self.run_script('import signal; signal.pause()', timeout=0.2)
        self.assertEqual(result.reason, 'timeout')
        self.assertFalse(result.successful)

    def test_nonzero_exit_overrides_success_event(self):
        result, _ = self.run_script(
            'import json; print(json.dumps({"type":"result","subtype":"success",'
            '"is_error":False})); raise SystemExit(7)')
        self.assertFalse(result.successful)
        self.assertEqual(result.returncode, 7)

    def test_codex_completed_turn_is_parsed(self):
        result, _ = self.run_script(
            'import json; print(json.dumps({"type":"item.completed",'
            '"item":{"type":"agent_message","text":"review done"}}));'
            'print(json.dumps({"type":"turn.completed"}))', backend='codex')
        self.assertTrue(result.successful)
        self.assertEqual(result.summary, 'review done')

    def test_malformed_nested_events_do_not_stop_stdout_drain(self):
        cases = (
            ('claude', 'assistant', 'message', {'id': 'valid-message'},
             {'type': 'result', 'subtype': 'success', 'is_error': False,
              'result': 'complete'}),
            ('codex', 'item.completed', 'item',
             {'type': 'agent_message', 'text': 'complete'}, {'type': 'turn.completed'}),
        )
        malformed_values: tuple[object, ...] = (None, [], 'invalid', 1, True)
        for backend, event_type, field, valid, terminal in cases:
            for malformed in malformed_values:
                with self.subTest(backend=backend, malformed=malformed):
                    events = [
                        {'type': event_type, field: malformed},
                        {'type': event_type, field: valid},
                        terminal,
                    ]
                    stream = ''.join(json.dumps(event) + '\n' for event in events)
                    result, directory = self.run_script(
                        f'import sys; sys.stdout.write({stream!r})', backend=backend)
                    self.assertTrue(result.successful)
                    self.assertEqual(result.summary, 'complete')
                    self.assertEqual(result.turns, 1)
                    self.assertEqual((directory / 'stream.jsonl').read_text(encoding='utf-8'),
                                     stream)

    def test_independent_checks_do_not_inherit_inference_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'check.log'
            with mock.patch.dict(os.environ, {'NVIDIA_API_KEY': 'fixture-key'}):
                verification.run_check(
                    [sys.executable, '-c', 'import os; print("NVIDIA_API_KEY" in os.environ); '
                     'print(os.environ["XDG_CACHE_HOME"])'],
                    output, time.monotonic() + 5,
                    env={'XDG_CACHE_HOME': temporary, 'NVIDIA_API_KEY': 'override-key'},
                )
            self.assertEqual(output.read_text(encoding='utf-8').splitlines(), ['False', temporary])

    def test_authentication_failure_is_not_retried(self):
        result = agent_runner.Attempt(reason='error', summary='Invalid API key')
        self.assertFalse(result.recoverable)


class RepositoryTest(unittest.TestCase):
    """Real git state makes staged/new/deleted-file behavior observable."""

    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))  # pylint: disable=consider-using-with
        self.repo = root / 'repo'
        self.repo.mkdir()
        self.artifacts = root / 'artifacts'
        self.artifacts.mkdir()
        previous = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, previous)
        subprocess.run(['git', 'init', '-q'], check=True)
        verification.git('config', 'user.email', 'test@example.com')
        verification.git('config', 'user.name', 'Test')
        (self.repo / 'src/tests').mkdir(parents=True)
        (self.repo / 'src/BUILD').write_text('', encoding='utf-8')
        (self.repo / 'src/tests/BUILD').write_text('', encoding='utf-8')
        (self.repo / 'src/example.py').write_text('def add(a, b):\n    return a - b\n', encoding='utf-8')
        verification.git('add', '.')
        verification.git('commit', '-qm', 'baseline')
        self.base = verification.git('rev-parse', 'HEAD').strip()
        self.meta = [{'file_path': 'src/example.py', 'uncovered_ranges': [[2, 2]]}]
        pipeline.write_json(self.artifacts / 'targets_meta.json', self.meta)

    def decision(self, output: Path, ready: bool = True):
        """Write an example endpoint decision."""
        pipeline.write_json(output, {'ready': ready, 'summary': 'Fixed source and regression test',
                                    'remaining_work': [], 'coverage_exceptions': []})


class TestRecovery(RepositoryTest):
    """Recovery retains work and must obtain an independent final verdict."""

    def test_generation_restarts_fresh_preserving_edits_and_turn_budget(self):
        calls = []

        def invoke(command, prompt, directory, timeout, backend):
            del directory, timeout, backend
            calls.append((command, prompt))
            if len(calls) == 1:
                Path('src/tests/test_example.py').write_text('partial test\n', encoding='utf-8')
                return agent_runner.Attempt(reason='compaction_failed', turns=78,
                                            summary='output cap')
            self.assertEqual(Path('src/tests/test_example.py').read_text(encoding='utf-8'), 'partial test\n')
            self.assertIn('src/tests/test_example.py', prompt)
            self.assertIn('compaction_failed', prompt)
            self.assertNotIn('--resume', command)
            self.assertEqual(command[-1], '322')
            return agent_runner.Attempt(returncode=0, reason='completed', turns=5,
                                        completed=True, successful=True)

        with mock.patch.dict(os.environ, {'ANTHROPIC_MODEL': 'test-model'}), \
                mock.patch.object(agent_runner, 'run_agent', side_effect=invoke):
            result = pipeline.generate('original work queue', self.artifacts, 400, 3, 60)
        self.assertTrue(result.successful)
        self.assertEqual(len(calls), 2)
        self.assertTrue((self.artifacts / 'generate-1.patch').exists())

    def test_generation_retries_are_bounded(self):
        with mock.patch.dict(os.environ, {'ANTHROPIC_MODEL': 'test-model'}), \
                mock.patch.object(agent_runner, 'run_agent', return_value=agent_runner.Attempt(
                    reason='timeout')) as run:
            result = pipeline.generate('work', self.artifacts, 400, 3, 60)
        self.assertFalse(result.successful)
        self.assertEqual(run.call_count, 3)

    def test_generator_source_edits_are_removed_before_independent_review(self):
        Path('src/example.py').write_text('unreviewed source edit\n', encoding='utf-8')
        Path('src/tests/test_example.py').write_text('generated regression\n', encoding='utf-8')
        Path('src/new_source.py').write_text('staged source addition\n', encoding='utf-8')
        verification.git('add', '.')
        Path('src/untracked.py').write_text('untracked source addition\n', encoding='utf-8')
        verification.retain_generated_tests()
        self.assertEqual(Path('src/example.py').read_text(encoding='utf-8'), 'def add(a, b):\n    return a - b\n')
        self.assertFalse(Path('src/new_source.py').exists())
        self.assertFalse(Path('src/untracked.py').exists())
        self.assertEqual(verification.changed_files(), ['src/tests/test_example.py'])
        self.assertEqual(verification.git('diff', '--cached', '--name-only').splitlines(),
                         ['src/tests/test_example.py'])

    def test_reviewer_can_fix_source_and_retry_failed_verification(self):
        prompts = []

        def invoke(command, prompt, directory, timeout, backend):
            del directory, timeout
            self.assertEqual(backend, 'codex')
            prompts.append(prompt)
            self.decision(Path(command[command.index('--output-last-message') + 1]))
            Path('src/example.py').write_text('def add(a, b):\n    return a + b\n', encoding='utf-8')
            return agent_runner.Attempt(returncode=0, reason='turn.completed', successful=True)

        def verify(meta, directory, base_commit, timeout, build_environment):
            del meta, base_commit, timeout
            self.assertEqual(build_environment['BAZELISK_HOME'],
                             str(self.artifacts / '.build-cache/bazelisk'))
            if len(prompts) == 1:
                raise RuntimeError('regression test still skipped')
            (directory / 'coverage_report.json').write_text('[]', encoding='utf-8')
            (directory / 'coverage_report.md').write_text('verified', encoding='utf-8')
            return [{'file_path': 'src/example.py', 'passed': True}]

        with mock.patch.object(agent_runner, 'run_agent', side_effect=invoke), \
                mock.patch.object(verification, 'verify', side_effect=verify):
            pipeline.review_and_verify('independent review', self.meta, self.artifacts,
                                       self.base, 3, 60, 60)
        self.assertEqual(len(prompts), 2)
        self.assertIn('regression test still skipped', prompts[1])
        self.assertEqual(verification.load_verified_changes(self.artifacts / 'verified_changes.json'),
                         ['src/example.py'])

    def test_ready_false_cannot_publish_or_skip_review(self):
        def invoke(command, *args):
            del args
            self.decision(Path(command[command.index('--output-last-message') + 1]), ready=False)
            return agent_runner.Attempt(returncode=0, reason='turn.completed', successful=True)

        with mock.patch.object(agent_runner, 'run_agent', side_effect=invoke), \
                mock.patch.object(verification, 'verify') as verify, \
                self.assertRaisesRegex(RuntimeError, 'did not complete'):
            pipeline.review_and_verify('review', self.meta, self.artifacts, self.base, 2, 60, 60)
        verify.assert_not_called()
        self.assertFalse((self.artifacts / 'verified_changes.json').exists())

    def test_missing_review_result_does_not_publish(self):
        with mock.patch.object(agent_runner, 'run_agent', return_value=agent_runner.Attempt(
                returncode=0, successful=True)), self.assertRaises(RuntimeError):
            pipeline.review_and_verify('review', self.meta, self.artifacts, self.base, 1, 60, 60)
        self.assertFalse((self.artifacts / 'verified_changes.json').exists())


    def test_separate_jobs_recover_and_publish_only_repaired_verified_content(self):
        """Use real agent processes and real regression execution through fake CLIs."""
        tools = self.artifacts / 'tools'
        tools.mkdir()
        fake_npx = tools / 'npx'
        fake_npx.write_text('#!/usr/bin/env python3\n' + r'''
import json
import os
from pathlib import Path
import signal
import sys
state = Path(os.environ['TESTBOT_FAKE_STATE'])
if any('claude-code' in arg for arg in sys.argv):
    counter = state / 'generation-count'
    count = int(counter.read_text()) + 1 if counter.exists() else 1
    counter.write_text(str(count))
    if count == 1:
        Path('src/tests/test_example.py').write_text(
            'import unittest\nfrom example import add\n\n'
            'class TestAdd(unittest.TestCase):\n'
            '    # SUSPECTED BUG: add subtracts instead of adding\n'
            '    @unittest.skip("source bug")\n'
            '    def test_add(self):\n'
            '        self.assertEqual(add(2, 3), 5)\n')
        print(json.dumps({'type': 'system', 'compact_result': 'failed',
                          'compact_error': 'response exceeded 20000 tokens'}), flush=True)
        signal.pause()
    else:
        print(json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False,
                          'terminal_reason': 'completed', 'num_turns': 2,
                          'result': 'Suspected bug left for independent reviewer'}))
else:
    # The review starts from files, with no generation conversation replay.
    Path('src/example.py').write_text('def add(a, b):\n    return a + b\n')
    test = Path('src/tests/test_example.py')
    test.write_text(test.read_text().replace('    @unittest.skip("source bug")\n', '')
                    .replace('    # SUSPECTED BUG: add subtracts instead of adding\n', ''))
    output = Path(sys.argv[sys.argv.index('--output-last-message') + 1])
    output.write_text(json.dumps({'ready': True, 'summary': 'Fixed add and enabled regression',
        'remaining_work': [], 'coverage_exceptions': [{'file_path': 'src/example.py',
        'reason': 'Original return line was replaced by the source fix; the enabled regression passes.'}]}))
    print(json.dumps({'type': 'turn.completed'}))
''', encoding='utf-8')
        fake_npx.chmod(0o755)
        fake_bazel = tools / 'bazel'
        fake_bazel.write_text('#!/usr/bin/env python3\n' + r'''
from pathlib import Path
import sys
import trace
import unittest
if sys.argv[1] == 'query':
    print('//src/tests:test_example')
else:
    sys.path.insert(0, str(Path('src').resolve()))
    suite = unittest.defaultTestLoader.discover('src/tests')
    tracer = trace.Trace(count=True, trace=False)
    result = tracer.runfunc(unittest.TextTestRunner().run, suite)
    if not result.wasSuccessful() or result.skipped:
        raise SystemExit(1)
    source = str(Path('src/example.py').resolve())
    hits = tracer.results().counts.get((source, 2), 0)
    if not hits:
        raise SystemExit('Source regression was not exercised')
    report = Path('bazel-out/_coverage/_coverage_report.dat')
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(f'SF:src/example.py\nDA:2,{hits}\nend_of_record\n')
''', encoding='utf-8')
        fake_bazel.chmod(0o755)
        Path('.gitignore').write_text('bazel-out/\n__pycache__/\n', encoding='utf-8')
        verification.git('add', '.gitignore')
        verification.git('commit', '-qm', 'ignore generated coverage')
        meta_path = self.artifacts / 'targets_meta.json'
        pipeline.write_json(meta_path, [dict(self.meta[0], coverage_pct=0.0, uncovered_lines=1)])
        output = self.artifacts / 'run'
        environment = {'PATH': str(tools) + os.pathsep + os.environ['PATH'],
                       'ANTHROPIC_MODEL': 'test-model', 'NVIDIA_API_KEY': 'test-key',
                       'TESTBOT_FAKE_STATE': str(self.artifacts)}
        real_agent = agent_runner.run_agent
        real_check = verification.run_check

        def run_agent(command, *args, **kwargs):
            return real_agent([str(fake_npx), *command[1:]], *args, **kwargs)

        def run_check(command, *args, **kwargs):
            self.assertEqual(kwargs['env']['BAZELISK_HOME'],
                             str(output / '.build-cache/bazelisk'))
            if command[1] == 'coverage':
                self.assertIn('--nocache_test_results', command)
            return real_check([str(fake_bazel), *command[1:]], *args, **kwargs)

        with mock.patch.object(agent_runner, 'run_agent', side_effect=run_agent), \
                mock.patch.object(verification, 'run_check', side_effect=run_check), \
                mock.patch.dict(os.environ, environment), mock.patch.object(sys, 'argv', [
                'pipeline.py', '--targets-meta', str(meta_path), '--artifacts', str(output),
                '--generation-timeout', '30', '--review-timeout', '30',
                '--verification-timeout', '30']):
            # Each stage runs in a separate clean checkout, as on Actions runners.
            sys.argv.extend(['--stage', 'generate'])
            pipeline.main()
            for stage in ('review', 'restore'):
                checkout = self.artifacts / f'{stage}-checkout'
                subprocess.run(['git', 'clone', '-q', str(self.repo), str(checkout)], check=True)
                os.chdir(checkout)
                sys.argv = ['pipeline.py', '--stage', stage, '--artifacts', str(output)]
                pipeline.main()
        self.assertEqual((self.artifacts / 'generation-count').read_text(encoding='utf-8'), '2')
        self.assertNotIn('unittest.skip', Path('src/tests/test_example.py').read_text(encoding='utf-8'))
        self.assertEqual(verification.load_verified_changes(output / 'verified_changes.json'),
                         ['src/example.py', 'src/tests/test_example.py'])
        self.assertIn('OK', (output / 'verify-1/bazel-coverage.log').read_text(encoding='utf-8'))
        self.assertIn('replaced/deleted', (output / 'coverage_report.md').read_text(encoding='utf-8'))
        self.assertTrue((output / 'generate-1.patch').is_file())
        self.assertTrue((output / 'final.patch').is_file())
        summaries = {stage: run_summary.render(output, stage, 'success', True)
                     for stage in ('selection', 'generation', 'review', 'publish')}
        self.assertIn('Generation attempt 1', summaries['generation'])
        self.assertIn('compaction_failed', summaries['generation'])
        self.assertIn('Verification attempt 1', summaries['review'])
        self.assertIn('Final verification completed', summaries['review'])
        self.assertIn('Dry run', summaries['publish'])
        self.assertIn('Verified changes restored successfully', summaries['publish'])
        for stage, summary in summaries.items():
            with self.subTest(stage=stage):
                self.assertEqual('Generation attempt 1' in summary, stage == 'generation')
                self.assertEqual('Verification attempt 1' in summary, stage == 'review')
                self.assertEqual('Selected targets' in summary, stage == 'selection')
                self.assertEqual('Coverage gain' in summary, stage == 'review')
                self.assertEqual('Dry run' in summary, stage == 'publish')


class TestHandoff(RepositoryTest):
    """Cross-runner patch reconstruction must preserve the checked content."""

    def clean_checkout(self):
        """Create a different checkout at the recorded base commit."""
        checkout = self.artifacts / 'next-runner'
        subprocess.run(['git', 'clone', '-q', str(self.repo), str(checkout)], check=True)
        os.chdir(checkout)

    def test_handoff_preserves_binary_new_deleted_files_and_modes(self):
        Path('src/example.py').unlink()
        new_file = Path('src/tests/test_binary.py')
        new_file.write_bytes(b'\0binary fixture\xff')
        new_file.chmod(0o755)
        pipeline.save_handoff(self.artifacts, self.base)
        expected = verification.fingerprint(verification.changed_files())
        self.clean_checkout()
        self.assertEqual(pipeline.restore_handoff(self.artifacts), self.base)
        self.assertEqual(verification.fingerprint(verification.changed_files()), expected)

    def test_wrong_base_rejected_before_applying_changes(self):
        Path('src/example.py').write_text('modified\n', encoding='utf-8')
        pipeline.save_handoff(self.artifacts, 'different-commit')
        self.clean_checkout()
        with self.assertRaisesRegex(ValueError, 'baseline differs'):
            pipeline.restore_handoff(self.artifacts)
        self.assertFalse(verification.changed_files())

    def test_harness_patch_rejected_before_application(self):
        scripts = Path('src/scripts/testbot')
        scripts.mkdir(parents=True)
        (scripts / 'pipeline.py').write_text('unreviewed harness edit', encoding='utf-8')
        pipeline.save_handoff(self.artifacts, self.base)
        self.clean_checkout()
        with self.assertRaisesRegex(ValueError, 'outside test/source repair scope'):
            pipeline.restore_handoff(self.artifacts)
        self.assertFalse(verification.changed_files())

    def test_altered_patch_cannot_be_published(self):
        Path('src/example.py').write_text('reviewed\n', encoding='utf-8')
        pipeline.save_handoff(self.artifacts, self.base)
        patch = self.artifacts / 'final.patch'
        patch.write_text(patch.read_text(encoding='utf-8').replace('+reviewed', '+tampered'),
                         encoding='utf-8')
        self.clean_checkout()
        with self.assertRaisesRegex(ValueError, 'contents differ'):
            pipeline.restore_handoff(self.artifacts)

    def test_missing_manifest_cannot_restore_for_publication(self):
        Path('src/example.py').write_text('unverified\n', encoding='utf-8')
        pipeline.save_handoff(self.artifacts, self.base)
        self.clean_checkout()
        with mock.patch.object(sys, 'argv', ['pipeline.py', '--stage', 'restore',
                                            '--artifacts', str(self.artifacts)]), \
                self.assertRaises(FileNotFoundError):
            pipeline.main()

    def test_no_targets_passes_through_all_stages_without_agents(self):
        metadata = self.artifacts / 'empty.json'
        pipeline.write_json(metadata, [])
        output = self.artifacts / 'empty-run'
        with mock.patch.object(agent_runner, 'run_agent') as run:
            for stage in ('generate', 'review', 'restore'):
                with mock.patch.object(sys, 'argv', ['pipeline.py', '--stage', stage,
                        '--artifacts', str(output), '--targets-meta', str(metadata)]):
                    pipeline.main()
            run.assert_not_called()
        self.assertTrue((output / 'skipped.json').exists())

    def test_missing_records_never_claim_verification_success(self):
        summary = run_summary.render(self.artifacts, 'review', 'failure', False)
        self.assertIn('publication is blocked', summary)
        self.assertNotIn('Final verification completed', summary)

    def test_summary_escapes_model_text_and_retains_failed_attempts(self):
        run_summary.record(self.artifacts, 'Review attempt 1', 'failed', time.monotonic(),
                           '<script>bad</script>|injected\nrow')
        summary = run_summary.render(self.artifacts, 'review', 'failure', False)
        self.assertIn('Review attempt 1', summary)
        self.assertIn('failed', summary)
        self.assertNotIn('<script>', summary)
        self.assertIn('&#124;', summary)


class TestVerification(RepositoryTest):
    """Bind approval to exact content and keep original coverage coordinates."""

    def manifest(self):
        """Issue a fixture manifest against the current checkout."""
        path = self.artifacts / 'verified_changes.json'
        pipeline.write_json(path, {'verified': True, 'base_commit': self.base,
                                  'files': verification.fingerprint(verification.changed_files())})
        return path

    def test_verified_source_and_new_test_are_allowed(self):
        Path('src/example.py').write_text('fixed source\n', encoding='utf-8')
        Path('src/tests/test_example.py').write_text('regression\n', encoding='utf-8')
        path = self.manifest()
        self.assertEqual(verification.load_verified_changes(path),
                         ['src/example.py', 'src/tests/test_example.py'])

    def test_post_verification_edit_is_rejected(self):
        Path('src/example.py').write_text('reviewed source\n', encoding='utf-8')
        path = self.manifest()
        Path('src/example.py').write_text('changed after checks\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'differ'):
            verification.load_verified_changes(path)

    def test_post_verification_executable_mode_change_is_rejected(self):
        source = Path('src/example.py')
        source.write_text('reviewed source\n', encoding='utf-8')
        path = self.manifest()
        source.chmod(source.stat().st_mode | 0o111)
        with self.assertRaisesRegex(ValueError, 'differ'):
            verification.load_verified_changes(path)

    def test_post_verification_new_file_is_rejected(self):
        Path('src/example.py').write_text('reviewed source\n', encoding='utf-8')
        path = self.manifest()
        Path('src/tests/test_other.py').write_text('unverified\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'differ'):
            verification.load_verified_changes(path)

    def test_manifest_accounts_for_staged_changes_and_deletion(self):
        Path('src/example.py').unlink()
        verification.git('add', '-u')
        path = self.manifest()
        self.assertEqual(verification.load_verified_changes(path), ['src/example.py'])
        self.assertIsNone(json.loads(path.read_text(encoding='utf-8'))['files']['src/example.py'])

    def test_source_line_insertion_maps_back_to_original_range(self):
        Path('src/example.py').write_text('# new comment\ndef add(a, b):\n    return a - b\n', encoding='utf-8')
        coverage, edited = verification.coverage_on_original_lines(
            self.meta, {'src/example.py': {2: 0, 3: 1}}, self.base)
        self.assertEqual(coverage['src/example.py'][2], 1)
        self.assertEqual(edited, ['src/example.py'])

    def test_replaced_source_line_is_not_miscredited(self):
        Path('src/example.py').write_text('def add(a, b):\n    return a + b\n', encoding='utf-8')
        coverage, _ = verification.coverage_on_original_lines(
            self.meta, {'src/example.py': {1: 1, 2: 1}}, self.base)
        self.assertNotIn(2, coverage['src/example.py'])

    def test_failure_does_not_reuse_stale_coverage(self):
        Path('src/tests/test_example.py').write_text('regression\n', encoding='utf-8')
        report = Path('bazel-out/_coverage/_coverage_report.dat')
        report.parent.mkdir(parents=True)
        report.write_text('SF:src/example.py\nDA:2,1\nend_of_record\n', encoding='utf-8')
        verification.git('add', 'bazel-out')
        verification.git('commit', '-qm', 'fixture coverage')
        self.base = verification.git('rev-parse', 'HEAD').strip()

        def run(command, output, deadline, env=None):
            del deadline, env
            if command[1] == 'query':
                output.write_text('//src/tests:test_example\n', encoding='utf-8')
            else:
                raise RuntimeError('bazel failed')

        with mock.patch.object(verification, 'run_check', side_effect=run), \
                self.assertRaisesRegex(RuntimeError, 'bazel failed'):
            verification.verify(self.meta, self.artifacts, self.base, 60)
        self.assertFalse(report.exists())
        self.assertFalse((self.artifacts / 'coverage_report.json').exists())


if __name__ == '__main__':
    unittest.main()
