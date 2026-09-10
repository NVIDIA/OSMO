"""Regression checks for the offline evaluation harness, not agent uplift.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SKILL = Path(__file__).resolve().parents[1] / 'osmo-user'
EVALS = SKILL / 'evals'
CASES = json.loads((EVALS / 'evals.json').read_text())['evals']


class EvalHarnessTest(unittest.TestCase):
    """Exercise staged cases with positive and deliberately incorrect commands."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def stage(self, number, suffix=''):
        """Mirror declared files only; graders and expectations stay outside."""
        entry = next(case for case in CASES if case['id'] == f'osmo-user-{number:03}')
        destination = self.root / f'{number}{suffix}'
        destination.mkdir()
        for relative in entry['files']:
            source = EVALS / relative
            target = destination / Path(relative).relative_to('files')
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)
        return destination

    def command(self, directory, *arguments, ok=True):
        """Invoke only the staged synthetic CLI, never the real osmo executable."""
        environment = {'PATH': str(Path(sys.executable).parent) + os.pathsep + os.defpath}
        result = subprocess.run(
            ['/bin/bash', str(directory / 'mock_osmo/osmo'), *arguments],
            cwd=directory, env=environment, capture_output=True, text=True, check=False,
        )
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result.stdout

    def test_all_cases_stage_unique_fixtures_without_oracles(self):
        self.assertEqual(len(CASES), 43)
        self.assertEqual(len({case['id'] for case in CASES}), len(CASES))
        for entry in CASES:
            with self.subTest(case=entry['id']):
                directory = self.stage(int(entry['id'].rsplit('-', 1)[1]))
                fixtures = list((directory / 'fixtures').glob('*/*'))
                self.assertEqual(len(fixtures), len({file.name for file in fixtures}))
                self.assertFalse((directory / 'evals.json').exists())
                self.assertFalse((directory / 'tests').exists())
                self.command(directory, '--version')
                is_new = int(entry['id'].rsplit('-', 1)[1]) >= 36
                self.assertEqual((directory / 'fixtures/cli_options/state.json').exists(), is_new)

    def test_workflow_filters_and_equivalent_order(self):
        directory = self.stage(36)
        flags = ['--status', 'RUNNING', 'PENDING', '--priority', 'HIGH', 'NORMAL',
                 '--label', 'project=(sim_train|hil_eval)', '--no-label', 'archived']
        result = json.loads(self.command(directory, 'workflow', 'list', *flags))
        self.assertEqual([row['name'] for row in result['workflows']],
                         ['sim-run-1', 'hil-run-1'])
        reordered = flags[3:6] + flags[6:] + flags[:3]
        self.assertEqual(json.loads(self.command(directory, 'workflow', 'list', *reordered)),
                         result)
        for omitted in (flags[3:], flags[:3] + flags[6:], flags[:6] + flags[8:], flags[:8]):
            self.assertNotEqual(
                json.loads(self.command(directory, 'workflow', 'list', *omitted)), result)

    def test_specific_failure_statuses(self):
        directory = self.stage(37)
        result = json.loads(self.command(directory, 'workflow', 'list', '--status',
                                         'FAILED_PREEMPTED', 'FAILED_IMAGE_PULL'))
        self.assertEqual([row['name'] for row in result['workflows']],
                         ['preempted-run-1', 'pull-run-1'])
        self.command(directory, 'workflow', 'list', '--status', 'PREEMPTED', ok=False)
        self.command(directory, 'workflow', 'list', '--invented-flag', ok=False)

    def test_lowercase_priorities_and_descending_order(self):
        directory = self.stage(36)
        upper = json.loads(self.command(directory, 'workflow', 'list',
                                        '--priority', 'HIGH', 'NORMAL'))['workflows']
        lower = json.loads(self.command(directory, 'workflow', 'list',
                                        '--priority', 'high', 'normal',
                                        '--order', 'desc'))['workflows']
        self.assertEqual(lower, list(reversed(upper)))

    def test_task_dates_priorities_and_aggregation(self):
        directory = self.stage(39)
        flags = ['--status', 'COMPLETED', '--priority', 'HIGH', 'NORMAL',
                 '--started-after', '2026-09-01', '--started-before', '2026-09-03', '-W']
        result = json.loads(self.command(directory, 'task', 'list', *flags))
        self.assertEqual(result, {'summaries': [
            {'workflow_id': 'batch-1', 'gpu': 6}, {'workflow_id': 'batch-2', 'gpu': 1}]})
        for omitted in (flags[2:], flags[:2] + flags[5:], flags[:5] + flags[7:],
                        flags[:7] + flags[9:], flags[:-1]):
            self.assertNotEqual(json.loads(self.command(directory, 'task', 'list', *omitted)),
                                result)
        self.command(directory, 'task', 'list', '--started-after', '2026-02-30', ok=False)
        self.command(directory, 'task', 'list', '--started-after', '2026-9-1', ok=False)

    def test_task_null_start_and_default_active_statuses(self):
        directory = self.stage(39)
        after = json.loads(self.command(directory, 'task', 'list',
                                        '--started-after', '2026-09-01'))['tasks']
        self.assertEqual({row['workflow_id'] for row in after}, {'active-1', 'queued-1'})
        bounded = json.loads(self.command(directory, 'task', 'list',
                                          '--started-after', '2026-09-01',
                                          '--started-before', '2026-09-03'))['tasks']
        self.assertEqual([row['workflow_id'] for row in bounded], ['active-1'])

    def test_app_local_path_and_per_run_overrides(self):
        directory = self.stage(40)
        state_path = directory / 'fixtures/cli_options/state.json'
        before = state_path.read_bytes()
        flags = ['training:2', '--pool', 'h100-east', '--local-path',
                 str(directory / 'app-inputs')]
        result = json.loads(self.command(directory, 'app', 'submit', *flags,
                                         '--label', 'project=simulation',
                                         '--label', 'team=robotics'))
        self.assertEqual(result['workflow_id'], 'gr00t-app-run-1')
        self.assertEqual(result['labels'], {'project': 'simulation', 'team': 'robotics'})
        self.assertEqual(state_path.read_bytes(), before)
        without_labels = json.loads(self.command(directory, 'app', 'submit', *flags))
        self.assertNotEqual(without_labels['labels'], result['labels'])
        self.command(directory, 'app', 'submit', *flags[:3], ok=False)
        self.command(directory, 'app', 'submit', 'training:1', *flags[1:], ok=False)
        self.command(directory, 'app', 'update', 'training:2', ok=False)

    def test_data_listing_file_and_stdout(self):
        directory = self.stage(41)
        output = directory / 'listing.txt'
        flags = ['s3://example-bucket/', '--prefix', 'results/', '--recursive']
        expected = 'results/first.txt\nresults/nested/second.txt\n'
        self.command(directory, 'data', 'list', str(flags[0]), str(output), *flags[1:])
        self.assertEqual(output.read_text(), expected)
        self.assertEqual(self.command(directory, 'data', 'list', *flags, '--no-pager'), expected)
        self.assertNotEqual(self.command(directory, 'data', 'list', *flags[:-1], '--no-pager'),
                            expected)
        self.assertNotEqual(self.command(directory, 'data', 'list', flags[0],
                                         '--recursive', '--no-pager'), expected)
        self.command(directory, 'data', 'download', flags[0], ok=False)

    def test_app_inspection_and_completed_monitoring(self):
        directory = self.stage(40)
        self.command(directory, 'resource', 'list', '--pool', 'h100-east')
        for verb in ('info', 'show'):
            info = json.loads(self.command(directory, 'app', verb, 'training:2'))
            self.assertEqual((info['name'], info['version']), ('training', 2))
        spec = self.command(directory, 'app', 'spec', 'training:2')
        self.assertIn('localpath: training.txt', spec)
        self.command(directory, 'app', 'submit', 'training:2', '--pool', 'h100-east',
                     '--local-path', str(directory / 'app-inputs'))
        query = json.loads(self.command(directory, 'workflow', 'query', 'gr00t-app-run-1',
                                        '--format-type', 'json'))
        self.assertEqual(query['status'], 'COMPLETED')
        self.assertEqual(query['app_name'], 'training')
        self.assertEqual(len(query['groups'][0]['tasks']), 1)
        self.assertIn('completed', self.command(directory, 'workflow', 'logs',
                                                'gr00t-app-run-1', '-n', '10000'))
        self.assertIn('completed', self.command(directory, 'workflow', 'events',
                                                'gr00t-app-run-1'))

    def test_data_output_conflicts_and_existing_path(self):
        directory = self.stage(43)
        existing = directory / 'existing-listing.txt'
        before = existing.read_bytes()
        flags = ['s3://example-bucket/', str(existing), '--recursive']
        self.command(directory, 'data', 'list', *flags, '--no-pager', ok=False)
        self.command(directory, 'data', 'list', *flags, ok=False)
        self.assertEqual(existing.read_bytes(), before)
        missing_parent = directory / 'missing/listing.txt'
        self.command(directory, 'data', 'list', flags[0], str(missing_parent), ok=False)
        self.assertFalse(missing_parent.exists())
        self.command(directory, 'data', 'list', flags[0], str(directory), ok=False)

    def test_validate_labels_without_submission_or_file_changes(self):
        directory = self.stage(44)
        workflow = directory / 'workflow.yaml'
        before = workflow.read_bytes()
        result = json.loads(self.command(directory, 'workflow', 'validate', 'workflow.yaml',
                                         '--pool', 'h100-east', '--label', 'project=simulation',
                                         '--label', 'team=robotics'))
        self.assertFalse(result['submitted'])
        self.assertEqual(result['labels'], {'project': 'simulation', 'team': 'robotics'})
        self.assertEqual(workflow.read_bytes(), before)

    def test_legacy_submit_state_is_per_case(self):
        first = self.stage(7)
        second = self.stage(7, '-other-trial')
        self.assertIn('gr00t-train-1', self.command(first, 'workflow', 'submit', 'workflow.yaml'))
        self.assertIn('gr00t-train-2', self.command(first, 'workflow', 'submit', 'workflow.yaml'))
        self.assertIn('gr00t-train-1', self.command(second, 'workflow', 'submit', 'workflow.yaml'))

    def test_legacy_oversized_retry_state_is_per_case(self):
        first = self.stage(18)
        second = self.stage(18, '-other-trial')
        self.command(first, 'workflow', 'submit', 'oversized.yaml', ok=False)
        self.command(first, 'workflow', 'submit', 'oversized.yaml')
        self.command(second, 'workflow', 'submit', 'oversized.yaml', ok=False)


if __name__ == '__main__':
    unittest.main()
