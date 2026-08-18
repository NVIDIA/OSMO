"""Unit tests for KIND service Secret setup."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import os
import secrets
import tempfile
import unittest
from unittest import mock

from run import start_service_kind


def _process(stdout: str = '', stderr: str = '', failed: bool = False) -> mock.Mock:
    stdout_file = tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8')
    stdout_file.write(stdout)
    stdout_file.close()
    stderr_file = tempfile.NamedTemporaryFile(mode='w', delete=False, encoding='utf-8')
    stderr_file.write(stderr)
    stderr_file.close()
    process = mock.Mock(stdout_file=stdout_file.name, stderr_file=stderr_file.name)
    process.has_failed.return_value = failed
    return process


def _kubectl_result(secret_data: dict[str, str] | None = None,
                    stderr: str = '', returncode: int = 0) -> mock.Mock:
    encoded_data = {
        key: base64.b64encode(value.encode('ascii')).decode('ascii')
        for key, value in (secret_data or {}).items()
    }
    stdout = json.dumps({'data': encoded_data}) if secret_data is not None else ''
    return mock.Mock(stdout=stdout, stderr=stderr, returncode=returncode)


class BackendTokenBootstrapTest(unittest.TestCase):
    """Validate that KIND setup uses kubectl without exposing the token."""

    def tearDown(self) -> None:
        for patcher in getattr(self, '_patchers', []):
            patcher.stop()
        for path in getattr(self, '_temporary_paths', []):
            if os.path.exists(path):
                os.unlink(path)

    def _patch_commands(self, *processes: mock.Mock) -> mock.Mock:
        self._temporary_paths = [
            path
            for process in processes
            for path in (process.stdout_file, process.stderr_file)
        ]
        patcher = mock.patch.object(
            start_service_kind, 'run_command_with_logging', side_effect=processes)
        self._patchers = [patcher]
        return patcher.start()

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_preserves_valid_existing_secret(self, subprocess_run: mock.Mock) -> None:
        token = secrets.token_urlsafe(32)
        subprocess_run.return_value = _kubectl_result({'token': token})

        start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

        subprocess_run.assert_called_once()
        command = subprocess_run.call_args.args[0]
        self.assertEqual(command[:4], ['kubectl', 'get', 'secret', 'agent-token'])
        self.assertEqual(command[-2:], ['-o', 'json'])

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_creates_missing_secret_with_protected_file(
            self, subprocess_run: mock.Mock) -> None:
        subprocess_run.return_value = _kubectl_result()
        run_command = self._patch_commands(_process())

        start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

        create_command = run_command.call_args.args[0]
        self.assertEqual(
            create_command[:6],
            ['kubectl', 'create', 'secret', 'generic', 'agent-token', '--namespace'])
        token_argument = next(
            argument for argument in create_command if argument.startswith('--from-file=token='))
        token_path = token_argument.split('=', 2)[2]
        self.assertFalse(os.path.exists(token_path))
        self.assertFalse(any('token=' in argument and argument != token_argument
                             for argument in create_command))

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_create_conflict_accepts_valid_concurrent_secret(
            self, subprocess_run: mock.Mock) -> None:
        subprocess_run.side_effect = [
            _kubectl_result(),
            _kubectl_result({'token': secrets.token_urlsafe(32)}),
        ]
        run_command = self._patch_commands(_process(stderr='AlreadyExists', failed=True))

        start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

        run_command.assert_called_once()
        self.assertEqual(subprocess_run.call_count, 2)

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_create_failure_without_secret_is_reported(
            self, subprocess_run: mock.Mock) -> None:
        subprocess_run.side_effect = [_kubectl_result(), _kubectl_result()]
        self._patch_commands(_process(stderr='forbidden', failed=True))

        with self.assertRaisesRegex(RuntimeError, 'forbidden'):
            start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_rejects_invalid_existing_token_without_printing_it(
            self, subprocess_run: mock.Mock) -> None:
        invalid_token = ('a' * 42) + '!'
        subprocess_run.return_value = _kubectl_result({'token': invalid_token})

        with self.assertRaisesRegex(RuntimeError, 'invalid format') as context:
            start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

        self.assertNotIn(invalid_token, str(context.exception))

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_rejects_duplicate_previous_token(
            self, subprocess_run: mock.Mock) -> None:
        token = secrets.token_urlsafe(32)
        subprocess_run.return_value = _kubectl_result({
            'token': token,
            'previous-token': token,
        })

        with self.assertRaisesRegex(RuntimeError, 'duplicate token'):
            start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

    @mock.patch.object(start_service_kind.subprocess, 'run')
    def test_kubectl_read_failure_does_not_expose_stdout(
            self, subprocess_run: mock.Mock) -> None:
        sensitive_stdout = secrets.token_urlsafe(32)
        subprocess_run.return_value = mock.Mock(
            stdout=sensitive_stdout,
            stderr='Unable to connect to the server',
            returncode=1,
        )

        with self.assertRaisesRegex(RuntimeError, 'Unable to connect') as context:
            start_service_kind._bootstrap_backend_token()  # pylint: disable=protected-access

        self.assertNotIn(sensitive_stdout, str(context.exception))


if __name__ == '__main__':
    unittest.main()
