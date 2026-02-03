#!/usr/bin/env python3
"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import sys
import unittest
from unittest.mock import patch

from run import start


class TestStartScript(unittest.TestCase):
    """Unit tests for the unified start script."""

    def setUp(self):
        """Set up test fixtures."""
        self.mock_logger = patch('run.start.logger').start()
        self.mock_check_tools = patch('run.start.check_required_tools').start()
        self.mock_start_service_bazel = patch('run.start.start_service_bazel').start()
        self.mock_start_backend_bazel = patch('run.start.start_backend_bazel').start()
        self.mock_start_service_kind = patch('run.start.start_service_kind').start()
        self.mock_start_backend_kind = patch('run.start.start_backend_kind').start()
        self.mock_detect_platform = patch('run.start.detect_platform').start()
        self.mock_login_osmo = patch('run.start.login_osmo').start()
        self.mock_logout_osmo = patch('run.start.logout_osmo').start()
        self.mock_update_workflow = patch('run.start.update_workflow_config').start()
        self.mock_update_pod = patch('run.start.update_pod_template_config').start()
        self.mock_update_dataset = patch('run.start.update_dataset_config').start()
        self.mock_update_service = patch('run.start.update_service_config').start()
        self.mock_update_backend = patch('run.start.update_backend_config').start()
        self.mock_set_pool = patch('run.start.set_default_pool').start()
        self.mock_print_next_steps = patch('run.start.print_next_steps').start()
        self.mock_wait_processes = patch('run.start.wait_for_all_processes').start()
        self.mock_cleanup = patch('run.start.cleanup_registered_processes').start()

    def tearDown(self):
        """Tear down test fixtures."""
        patch.stopall()

    def test_start_bazel_default(self):
        """Test starting in bazel mode with default settings."""
        test_args = ['start.py', '--mode', 'bazel']
        with patch.object(sys, 'argv', test_args):
            start.main()

        # Check required tools
        self.mock_check_tools.assert_any_call(['bazel'])
        self.mock_check_tools.assert_any_call(['docker', 'npm', 'aws'])

        # Check services started (bazel mode)
        self.mock_start_service_bazel.assert_called_once_with(
            wait=False, print_next_steps_action=False
        )
        self.mock_start_backend_bazel.assert_called_once_with(
            'osmo', wait=False, print_next_steps_action=False
        )

        # Check configs updated
        self.mock_login_osmo.assert_called_once_with('bazel')
        self.mock_update_workflow.assert_called()
        self.mock_logout_osmo.assert_called_once()

        # Check wait called
        self.mock_wait_processes.assert_called_once()

    def test_start_kind_default(self):
        """Test starting in kind mode with default settings."""
        test_args = ['start.py', '--mode', 'kind']
        with patch.object(sys, 'argv', test_args):
            start.main()

        # Check required tools
        self.mock_check_tools.assert_any_call(['kind', 'kubectl', 'helm', 'docker'])

        # Check services started (kind mode)
        self.mock_start_service_kind.assert_called_once()
        self.mock_start_backend_kind.assert_called_once()

        # Check configs updated
        self.mock_login_osmo.assert_called_once_with('kind')

        # Check wait NOT called (kind mode doesn't wait)
        self.mock_wait_processes.assert_not_called()

    def test_skip_flags(self):
        """Test skip flags functionality."""
        test_args = [
            'start.py', '--mode', 'bazel',
            '--skip-services', '--skip-backend', '--skip-configs'
        ]
        with patch.object(sys, 'argv', test_args):
            start.main()

        self.mock_start_service_bazel.assert_not_called()
        self.mock_start_backend_bazel.assert_not_called()
        self.mock_login_osmo.assert_not_called()

    def test_config_file_merge(self):
        """Test config file merging logic."""
        config_content = """
mode: kind
cluster_name: my-cluster
skip_services: true
        """

        test_args = ['start.py', '--config', 'test_config.yaml']

        with patch('builtins.open', new_callable=unittest.mock.mock_open, read_data=config_content):
            with patch('os.path.exists', return_value=True):
                with patch.object(sys, 'argv', test_args):
                    start.main()

        # Verify args were updated from config
        # mode should start kind service/backend, but skip-services is True
        self.mock_start_service_kind.assert_not_called()
        self.mock_start_backend_kind.assert_called()

        # Verify cluster name passed
        # Accessing call args to verify cluster name
        call_args = self.mock_start_backend_kind.call_args[0][0]
        self.assertEqual(call_args.cluster_name, 'my-cluster')


if __name__ == '__main__':
    unittest.main()
