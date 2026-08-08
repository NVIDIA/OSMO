"""Unit tests for KIND backend bootstrap helpers."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import os
import tempfile
import unittest
from unittest import mock

from run import start_backend_kind


class BackendTokenSecretTest(unittest.TestCase):
    """Tests backend credential Secret discovery."""

    @mock.patch.object(start_backend_kind, 'run_command_with_logging')
    def test_presence_check_does_not_read_token(self, run_command: mock.Mock) -> None:
        with tempfile.NamedTemporaryFile(mode='w', delete=False,
                                         encoding='utf-8') as output_file:
            output_file.write('present')
        self.addCleanup(os.unlink, output_file.name)

        process = mock.Mock(stdout_file=output_file.name)
        process.has_failed.return_value = False
        run_command.return_value = process

        self.assertTrue(start_backend_kind.check_backend_token_exists())

        command = run_command.call_args.args[0]
        self.assertFalse([argument for argument in command if 'jsonpath' in argument])
        self.assertIn('--ignore-not-found=true', command)
        self.assertIn(
            'go-template={{if index .data "token"}}present{{end}}', command)

    @mock.patch.object(start_backend_kind, 'run_command_with_logging')
    def test_missing_presence_marker_is_rejected(self, run_command: mock.Mock) -> None:
        with tempfile.NamedTemporaryFile(mode='w', delete=False,
                                         encoding='utf-8') as output_file:
            output_file.write('')
        self.addCleanup(os.unlink, output_file.name)

        process = mock.Mock(stdout_file=output_file.name)
        process.has_failed.return_value = False
        run_command.return_value = process

        self.assertFalse(start_backend_kind.check_backend_token_exists())

    @mock.patch.object(start_backend_kind, 'run_command_with_logging')
    def test_kubectl_failure_reports_command_error(self, run_command: mock.Mock) -> None:
        with tempfile.NamedTemporaryFile(mode='w', delete=False,
                                         encoding='utf-8') as error_file:
            error_file.write('Unable to connect to the server')
        self.addCleanup(os.unlink, error_file.name)

        process = mock.Mock(stderr_file=error_file.name)
        process.has_failed.return_value = True
        run_command.return_value = process

        with self.assertRaisesRegex(RuntimeError, 'Unable to connect to the server'):
            start_backend_kind.check_backend_token_exists()

    @mock.patch.object(start_backend_kind, 'check_backend_token_exists', return_value=False)
    @mock.patch.object(start_backend_kind, 'run_command_with_logging')
    def test_missing_secret_requires_service_install(
            self, run_command: mock.Mock, check_backend_token: mock.Mock) -> None:
        process = mock.Mock()
        process.has_failed.return_value = False
        run_command.return_value = process

        with self.assertRaisesRegex(
                RuntimeError, 'Install the OSMO service first'):
            start_backend_kind._setup_backend_operators(  # pylint: disable=protected-access
                'registry.example.com/osmo', 'latest', 'amd64')
        check_backend_token.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
