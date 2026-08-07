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
        self.assertNotIn('jsonpath={.data.token}', command)
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


if __name__ == '__main__':
    unittest.main()
