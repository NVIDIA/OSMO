"""Nightly job boundaries and selection must survive the chart/auth migration.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

import yaml

from test.oetf import environments, main as oetf_main


ROOT = Path(os.environ['TEST_SRCDIR']) / '_main'
CI = ROOT / 'ci/deployment-test'
WORKFLOW = ROOT / '.github/workflows/deployment-test.yaml'


class WorkflowContractTest(unittest.TestCase):
    """Exercise executable gate logic and the framework's existing resolver."""

    def setUp(self):
        self.workflow = yaml.safe_load(WORKFLOW.read_text(encoding='utf-8'))
        self.jobs = self.workflow['jobs']

    def test_gate_distinguishes_no_cloud_and_unknown(self):
        step = next(step for step in self.jobs['tf-destroy']['steps']
                    if step.get('id') == 'attempt')
        for gate, expected in [('success', 'true'), ('skipped', 'false'),
                               ('failure', 'false'), ('', ''), ('cancelled', '')]:
            with self.subTest(gate=gate), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / 'outputs'
                summary = Path(temporary) / 'summary'
                result = subprocess.run(
                    ['bash', '-e', '-c', step['run']], check=False,
                    env={**os.environ, 'CLOUD_GATE': gate,
                         'GITHUB_OUTPUT': str(output), 'GITHUB_STEP_SUMMARY': str(summary)},
                    capture_output=True, text=True,
                )
                if expected:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn(f'started={expected}', output.read_text(encoding='utf-8'))
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(output.exists())

    def test_failure_cleanup_is_separate_from_successful_oetf(self):
        self.assertNotIn('tf-apply', self.jobs)
        self.assertNotIn('tf-destroy-apply-failure', self.jobs)
        self.assertEqual(self.jobs['oetf']['needs'], ['build-images', 'deploy-osmo'])
        cleanup = self.jobs['tf-destroy']
        self.assertEqual(cleanup['needs'], ['deploy-osmo', 'oetf'])
        self.assertIn('always()', cleanup['if'])
        self.assertNotIn("== 'success'", cleanup['if'])
        steps = {step.get('id'): step for step in cleanup['steps'] if 'id' in step}
        for phase in ['restore', 'destroy', 'sweep']:
            self.assertIn('always()', steps[phase]['if'])
        self.assertNotIn('restore', steps['sweep']['if'])
        self.assertNotIn('destroy', steps['sweep']['if'])
        self.assertIn('steps.scope.outcome', steps['sweep']['if'])

    def test_marker_upload_precedes_cloud_work_and_state_survives_failure(self):
        steps = self.jobs['deploy-osmo']['steps']
        marker_index = next(i for i, step in enumerate(steps) if step.get('id') == 'marker_upload')
        for i, step in enumerate(steps):
            command = step.get('run', '')
            if ('azure-cleanup.sh sweep' in command or
                    'bash deployments/scripts/deploy-osmo-single-plane.sh' in command):
                self.assertGreater(i, marker_index)
                self.assertNotIn('continue-on-error', steps[marker_index])
            if step.get('id') == 'state':
                self.assertIn('always()', step['if'])
                self.assertIn("steps.marker_upload.outcome == 'success'", step['if'])
        outputs = self.jobs['deploy-osmo']['outputs']
        self.assertIn('steps.identity.outputs', outputs['marker_artifact'])
        self.assertIn('steps.identity.outputs', outputs['producer_attempt'])

    def test_existing_oetf_selection_uses_identical_query(self):
        envs = environments.load_environments([
            str(ROOT / 'test/oetf/data/oetf.default.yaml'), str(CI / 'oetf-single-plane.yaml'),
        ])
        old, new = envs['kind'], envs['azure-single-plane']
        self.assertEqual(new.type, 'custom')
        self.assertFalse(new.allow_deploy)
        self.assertEqual(new.auth.strategy, 'token')
        self.assertEqual(new.exclude_tags, old.exclude_tags)
        queries = []
        for env in (old, new):
            with mock.patch.object(
                oetf_main.subprocess, 'check_output',
                return_value='//test/smoke:api-checks\n',
            ) as query:
                # The actual Bazel metadata query is also run outside this unit
                # test, avoiding a nested Bazel invocation/deadlock in sh_test.
                targets = oetf_main._resolve_targets_via_query(  # pylint: disable=protected-access
                    'api,websocket,logger,task-env,negative', ','.join(env.exclude_tags),
                )
                self.assertTrue(targets)
                queries.append(query.call_args.args[0])
        self.assertEqual(queries[0], queries[1])
        self.assertIn('(auth|mcp)', queries[1][2])


if __name__ == '__main__':
    unittest.main()
