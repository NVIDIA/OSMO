"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import argparse
import json
import os
import tempfile
import unittest
from unittest import mock

from src.cli import data
from src.lib.data import storage
from src.lib.utils import client, logging as logging_utils, osmo_errors


def _make_args(**overrides) -> argparse.Namespace:
    """Build an argparse.Namespace with sensible defaults for data CLI commands."""
    defaults = {
        'remote_uri': 's3://bucket/prefix',
        'local_path': '/tmp/some/path',
        'regex': None,
        'processes': 2,
        'threads': 4,
        'benchmark_out': None,
        'resume': False,
        'prefix': '',
        'recursive': False,
        'no_pager': False,
        'access_type': None,
        'config_file': None,
        'log_level': logging_utils.LoggingLevel.INFO,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


class TestRunUploadCommand(unittest.TestCase):
    """Test cases for the _run_upload_command function."""

    def test_run_upload_command_invokes_storage_client_upload(self):
        """Test that upload creates a storage client and uploads with provided args."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/',
            local_path=['/tmp/a', '/tmp/b'],
            regex=r'\.txt$',
            benchmark_out='/tmp/bench',
            processes=3,
            threads=8,
        )
        storage_client = mock.Mock()

        with mock.patch.object(storage.Client, 'create', return_value=storage_client) as create_mock:
            data._run_upload_command(service_client, args)

        create_mock.assert_called_once()
        call_kwargs = create_mock.call_args.kwargs
        self.assertEqual(call_kwargs['storage_uri'], 's3://bucket/')
        self.assertEqual(call_kwargs['metrics_dir'], '/tmp/bench')
        self.assertTrue(call_kwargs['enable_progress_tracker'])
        self.assertEqual(call_kwargs['executor_params'].num_processes, 3)
        self.assertEqual(call_kwargs['executor_params'].num_threads, 8)
        storage_client.upload_objects.assert_called_once_with(
            ['/tmp/a', '/tmp/b'],
            regex=r'\.txt$',
        )


class TestRunDownloadCommand(unittest.TestCase):
    """Test cases for the _run_download_command function."""

    def test_run_download_command_invokes_storage_client_download(self):
        """Test that download creates a client and calls download_objects."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/data',
            local_path='/tmp/dl',
            regex=None,
            resume=True,
            processes=1,
            threads=2,
        )
        storage_client = mock.Mock()

        with mock.patch.object(storage.Client, 'create', return_value=storage_client) as create_mock:
            data._run_download_command(service_client, args)

        create_mock.assert_called_once()
        storage_client.download_objects.assert_called_once_with(
            '/tmp/dl',
            regex=None,
            resume=True,
        )


class TestRunListCommand(unittest.TestCase):
    """Test cases for the _run_list_command function."""

    def _make_list_result(self, key: str):
        result = mock.Mock()
        result.key = key
        return result

    def _make_list_gen(self, keys, summary_count=None):
        """Create a mock generator-like object with iteration and .summary."""
        results = [self._make_list_result(k) for k in keys]
        gen = mock.MagicMock()
        gen.__iter__.return_value = iter(results)
        if summary_count is None:
            gen.summary = None
        else:
            summary = mock.Mock()
            summary.count = summary_count
            gen.summary = summary
        return gen

    def test_run_list_command_writes_to_local_path_when_provided(self):
        """Test that list writes object keys to a local file when local_path is set."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['foo.txt', 'bar.txt'], summary_count=2)
        storage_client.list_objects.return_value = gen

        with tempfile.TemporaryDirectory() as tmp_dir:
            out_path = os.path.join(tmp_dir, 'out.txt')
            args = _make_args(
                remote_uri='s3://bucket/',
                local_path=out_path,
                prefix='pre',
                recursive=True,
                no_pager=False,
            )

            with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
                 mock.patch('builtins.print') as mock_print:
                data._run_list_command(service_client, args)

            with open(out_path, 'r', encoding='utf-8') as fh:
                content = fh.read()

        self.assertIn('foo.txt', content)
        self.assertIn('bar.txt', content)
        storage_client.list_objects.assert_called_once_with(
            prefix='pre',
            regex=None,
            recursive=True,
        )
        summary_output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertIn('Total 2 objects found', summary_output)

    def test_run_list_command_prints_to_stdout_when_no_pager(self):
        """Test that list prints to stdout when --no-pager is enabled."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['alpha', 'beta'], summary_count=2)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=True)

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('sys.stdout') as mock_stdout, \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        writes = ''.join(
            call.args[0] for call in mock_stdout.write.call_args_list
        )
        self.assertIn('alpha', writes)
        self.assertIn('beta', writes)

    def test_run_list_command_falls_back_to_stdout_when_no_pager_found(self):
        """Test that list falls back to stdout when less/more are unavailable."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['only.txt'], summary_count=1)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=False)

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('src.cli.data.shutil.which', return_value=None), \
             mock.patch('sys.stdout') as mock_stdout, \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        writes = ''.join(
            call.args[0] for call in mock_stdout.write.call_args_list
        )
        self.assertIn('only.txt', writes)

    def test_run_list_command_uses_pager_when_available(self):
        """Test that list pipes results to a pager when one is available."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['p1', 'p2'], summary_count=2)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=False)

        fake_stdin = mock.MagicMock()
        fake_proc = mock.MagicMock()
        fake_proc.stdin = fake_stdin
        fake_proc.__enter__.return_value = fake_proc
        fake_proc.__exit__.return_value = False

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('src.cli.data.shutil.which', return_value='/usr/bin/less'), \
             mock.patch('src.cli.data.subprocess.Popen', return_value=fake_proc) as popen_mock, \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        popen_mock.assert_called_once()
        writes = ''.join(
            call.args[0] for call in fake_stdin.write.call_args_list
        )
        self.assertIn('p1', writes)
        self.assertIn('p2', writes)
        fake_stdin.close.assert_called_once()

    def test_run_list_command_tolerates_broken_pipe_on_pager_close(self):
        """Test that broken pipe errors during pager close are swallowed."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['pipe-item'], summary_count=1)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=False)

        fake_stdin = mock.MagicMock()
        fake_stdin.close.side_effect = BrokenPipeError()
        fake_proc = mock.MagicMock()
        fake_proc.stdin = fake_stdin
        fake_proc.__enter__.return_value = fake_proc
        fake_proc.__exit__.return_value = False

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('src.cli.data.shutil.which', return_value='/usr/bin/less'), \
             mock.patch('src.cli.data.subprocess.Popen', return_value=fake_proc), \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        fake_stdin.close.assert_called_once()

    def test_run_list_command_falls_back_to_stdout_when_pager_has_no_stdin(self):
        """Test that list falls back to stdout when the pager has no stdin."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['no-stdin-item'], summary_count=1)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=False)

        fake_proc = mock.MagicMock()
        fake_proc.stdin = None
        fake_proc.__enter__.return_value = fake_proc
        fake_proc.__exit__.return_value = False

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('src.cli.data.shutil.which', return_value='/usr/bin/less'), \
             mock.patch('src.cli.data.subprocess.Popen', return_value=fake_proc), \
             mock.patch('sys.stdout') as mock_stdout, \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        writes = ''.join(
            call.args[0] for call in mock_stdout.write.call_args_list
        )
        self.assertIn('no-stdin-item', writes)

    def test_run_list_command_skips_summary_when_summary_is_none(self):
        """Test that the summary 'Total N objects' message is not printed when summary is None."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['x'], summary_count=None)
        storage_client.list_objects.return_value = gen
        args = _make_args(local_path=None, no_pager=True)

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('sys.stdout'), \
             mock.patch('builtins.print') as mock_print:
            data._run_list_command(service_client, args)

        summary_output = ' '.join(
            str(arg) for call in mock_print.call_args_list for arg in call.args
        )
        self.assertNotIn('objects found', summary_output)

    def test_emit_list_results_breaks_on_broken_pipe(self):
        """Test that _emit_list_results stops writing after a BrokenPipeError."""
        service_client = mock.Mock(spec=client.ServiceClient)
        storage_client = mock.Mock()
        gen = self._make_list_gen(['a', 'b', 'c'], summary_count=3)
        storage_client.list_objects.return_value = gen

        fake_pipe = mock.MagicMock()
        fake_pipe.write.side_effect = BrokenPipeError()
        args = _make_args(local_path=None, no_pager=True)

        with mock.patch.object(storage.Client, 'create', return_value=storage_client), \
             mock.patch('sys.stdout', fake_pipe), \
             mock.patch('builtins.print'):
            data._run_list_command(service_client, args)

        # First write raised BrokenPipeError; iteration should stop immediately.
        self.assertEqual(fake_pipe.write.call_count, 1)


class TestRunDeleteCommand(unittest.TestCase):
    """Test cases for the _run_delete_command function."""

    def test_run_delete_command_invokes_storage_client_delete(self):
        """Test that delete creates a client and calls delete_objects with regex."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(remote_uri='s3://bucket/', regex=r'\.log$')
        storage_client = mock.Mock()

        with mock.patch.object(storage.Client, 'create', return_value=storage_client) as create_mock:
            data._run_delete_command(service_client, args)

        create_mock.assert_called_once()
        self.assertEqual(create_mock.call_args.kwargs['storage_uri'], 's3://bucket/')
        storage_client.delete_objects.assert_called_once_with(regex=r'\.log$')


class TestRunCheckCommand(unittest.TestCase):
    """Test cases for the _run_check_command function."""

    def _setup_backend(self, profile_name: str = 'my-profile'):
        storage_backend = mock.Mock()
        storage_backend.profile = profile_name
        return storage_backend

    def test_run_check_command_read_access_prints_pass(self):
        """Test that READ access calls data_auth with READ and prints pass status."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='@my-profile',
            access_type='READ',
            config_file=None,
        )
        storage_backend = self._setup_backend()
        data_cred = mock.Mock()

        with mock.patch('src.cli.data.storage.construct_storage_backend', return_value=storage_backend), \
             mock.patch(
                 'src.cli.data.credentials.get_static_data_credential_from_config',
                 return_value=data_cred,
             ), \
             mock.patch('builtins.print') as mock_print:
            data._run_check_command(service_client, args)

        storage_backend.data_auth.assert_called_once_with(
            data_cred=data_cred,
            access_type=storage.AccessType.READ,
        )
        mock_print.assert_called_once()
        output = mock_print.call_args[0][0]
        self.assertEqual(json.loads(output), {'status': 'pass'})

    def test_run_check_command_write_access_uses_write_type(self):
        """Test that WRITE access calls data_auth with WRITE."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/',
            access_type='WRITE',
        )
        storage_backend = self._setup_backend()

        with mock.patch('src.cli.data.storage.construct_storage_backend', return_value=storage_backend), \
             mock.patch('src.cli.data.credentials.get_static_data_credential_from_config', return_value=mock.Mock()), \
             mock.patch('builtins.print'):
            data._run_check_command(service_client, args)

        storage_backend.data_auth.assert_called_once()
        self.assertEqual(
            storage_backend.data_auth.call_args.kwargs['access_type'],
            storage.AccessType.WRITE,
        )

    def test_run_check_command_delete_access_uses_delete_type(self):
        """Test that DELETE access calls data_auth with DELETE."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/',
            access_type='DELETE',
        )
        storage_backend = self._setup_backend()

        with mock.patch('src.cli.data.storage.construct_storage_backend', return_value=storage_backend), \
             mock.patch('src.cli.data.credentials.get_static_data_credential_from_config', return_value=mock.Mock()), \
             mock.patch('builtins.print'):
            data._run_check_command(service_client, args)

        self.assertEqual(
            storage_backend.data_auth.call_args.kwargs['access_type'],
            storage.AccessType.DELETE,
        )

    def test_run_check_command_default_access_type_does_not_pass_access_type(self):
        """Test that when access_type is None, data_auth is called without an access_type kwarg."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/',
            access_type=None,
        )
        storage_backend = self._setup_backend()

        with mock.patch('src.cli.data.storage.construct_storage_backend', return_value=storage_backend), \
             mock.patch('src.cli.data.credentials.get_static_data_credential_from_config', return_value=mock.Mock()), \
             mock.patch('builtins.print'):
            data._run_check_command(service_client, args)

        storage_backend.data_auth.assert_called_once()
        self.assertNotIn('access_type', storage_backend.data_auth.call_args.kwargs)

    def test_run_check_command_credential_error_prints_fail_status(self):
        """Test that an OSMOCredentialError is reported as fail with error message."""
        service_client = mock.Mock(spec=client.ServiceClient)
        args = _make_args(
            remote_uri='s3://bucket/',
            access_type='READ',
        )
        storage_backend = self._setup_backend()
        storage_backend.data_auth.side_effect = osmo_errors.OSMOCredentialError(
            'bad credentials'
        )

        with mock.patch('src.cli.data.storage.construct_storage_backend', return_value=storage_backend), \
             mock.patch('src.cli.data.credentials.get_static_data_credential_from_config', return_value=mock.Mock()), \
             mock.patch('builtins.print') as mock_print:
            data._run_check_command(service_client, args)

        mock_print.assert_called_once()
        parsed = json.loads(mock_print.call_args[0][0])
        self.assertEqual(parsed['status'], 'fail')
        self.assertIn('bad credentials', parsed['error'])


class TestSetupParser(unittest.TestCase):
    """Test cases for the setup_parser function."""

    def _build_parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser()
        subparsers = parser.add_subparsers()
        data.setup_parser(subparsers)
        return parser

    def test_setup_parser_upload_command_sets_func(self):
        """Test that the upload subcommand wires up _run_upload_command."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'upload', 's3://bucket/', '/tmp/a'])
        self.assertEqual(args.func, data._run_upload_command)
        self.assertEqual(args.remote_uri, 's3://bucket/')
        self.assertEqual(args.local_path, ['/tmp/a'])

    def test_setup_parser_upload_accepts_multiple_local_paths(self):
        """Test that the upload subcommand accepts multiple local paths."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'upload', 's3://bucket/', '/tmp/a', '/tmp/b'])
        self.assertEqual(args.local_path, ['/tmp/a', '/tmp/b'])

    def test_setup_parser_upload_uses_default_processes_and_threads(self):
        """Test that upload defaults processes/threads to storage defaults."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'upload', 's3://bucket/', '/tmp/a'])
        self.assertEqual(args.processes, storage.DEFAULT_NUM_PROCESSES)
        self.assertEqual(args.threads, storage.DEFAULT_NUM_THREADS)

    def test_setup_parser_download_command_sets_func(self):
        """Test that the download subcommand wires up _run_download_command."""
        parser = self._build_parser()
        with tempfile.TemporaryDirectory() as tmp_dir:
            args = parser.parse_args(['data', 'download', 's3://bucket/', tmp_dir])
            self.assertEqual(args.func, data._run_download_command)
            self.assertEqual(args.local_path, tmp_dir)
            self.assertFalse(args.resume)

    def test_setup_parser_download_resume_flag(self):
        """Test that the download subcommand accepts the --resume flag."""
        parser = self._build_parser()
        with tempfile.TemporaryDirectory() as tmp_dir:
            args = parser.parse_args(['data', 'download', 's3://bucket/', tmp_dir, '--resume'])
            self.assertTrue(args.resume)

    def test_setup_parser_list_command_sets_func(self):
        """Test that the list subcommand wires up _run_list_command."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'list', 's3://bucket/'])
        self.assertEqual(args.func, data._run_list_command)
        self.assertEqual(args.prefix, '')
        self.assertFalse(args.recursive)
        self.assertFalse(args.no_pager)

    def test_setup_parser_list_no_pager_flag(self):
        """Test that the list subcommand accepts --no-pager."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'list', 's3://bucket/', '--no-pager'])
        self.assertTrue(args.no_pager)

    def test_setup_parser_list_recursive_and_prefix(self):
        """Test that list accepts --recursive and --prefix flags."""
        parser = self._build_parser()
        args = parser.parse_args(
            ['data', 'list', 's3://bucket/', '--recursive', '--prefix', 'foo/']
        )
        self.assertTrue(args.recursive)
        self.assertEqual(args.prefix, 'foo/')

    def test_setup_parser_delete_command_sets_func(self):
        """Test that the delete subcommand wires up _run_delete_command."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'delete', 's3://bucket/'])
        self.assertEqual(args.func, data._run_delete_command)

    def test_setup_parser_check_command_sets_func(self):
        """Test that the check subcommand wires up _run_check_command."""
        parser = self._build_parser()
        args = parser.parse_args(['data', 'check', 's3://bucket/'])
        self.assertEqual(args.func, data._run_check_command)
        self.assertIsNone(args.access_type)

    def test_setup_parser_check_accepts_access_type(self):
        """Test that check accepts --access-type flag with valid value."""
        parser = self._build_parser()
        args = parser.parse_args(
            ['data', 'check', 's3://bucket/', '--access-type', 'READ']
        )
        self.assertEqual(args.access_type, 'READ')

    def test_setup_parser_check_rejects_invalid_access_type(self):
        """Test that check rejects an invalid --access-type choice."""
        parser = self._build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(
                ['data', 'check', 's3://bucket/', '--access-type', 'INVALID']
            )


if __name__ == '__main__':
    unittest.main()
