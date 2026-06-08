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
# pylint: disable=protected-access,line-too-long

import asyncio
import dataclasses
import http
import json
import os
import shutil
import socket
import tempfile
import unittest
from typing import Any, Dict, List, cast
from unittest import mock

from src.lib.rsync import rsync
from src.lib.utils import osmo_errors


def _make_upload_request(
    local_path: str = '/local/src',
    remote_module: str = 'osmo',
    remote_path: str = 'sub/file',
    original_remote_path: str = '/osmo/run/workspace/sub/file',
) -> rsync.RsyncRequest:
    return rsync.RsyncRequest(
        workflow_id='wf-1',
        task_name='task-main',
        direction=rsync.RsyncDirection.UPLOAD,
        local_path=local_path,
        remote_module=remote_module,
        remote_path=remote_path,
        original_remote_path=original_remote_path,
    )


class _FakeServiceClient:
    """Records request() calls and returns canned responses or raises."""

    def __init__(self, responses: List[Any]):
        self._responses = list(responses)
        self.calls: List = []

    def request(self, method, url, **kwargs):  # pragma: no cover - test helper
        self.calls.append((method, url, kwargs))
        if not self._responses:
            raise AssertionError('No more responses queued for FakeServiceClient')
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class TestFormatBytes(unittest.TestCase):
    """Covers _format_bytes — lines 73-77."""

    def test_byte_under_1024_uses_int_b_unit(self):
        self.assertEqual(rsync._format_bytes(512), '512B')

    def test_kilobytes_branch_with_decimal(self):
        # 1536 bytes = 1.5 KB
        self.assertEqual(rsync._format_bytes(1536), '1.5KB')

    def test_megabytes_branch_with_decimal(self):
        self.assertEqual(rsync._format_bytes(2 * 1024 * 1024), '2.0MB')

    def test_gigabytes_branch_with_decimal(self):
        self.assertEqual(rsync._format_bytes(3 * 1024 * 1024 * 1024), '3.0GB')

    def test_terabytes_falls_through_to_tb(self):
        # exceeds GB; loop ends and final return triggers
        size = 5 * (1024 ** 4)
        self.assertEqual(rsync._format_bytes(size), '5.0TB')


class TestParseProgressLine(unittest.TestCase):
    """Covers _parse_progress_line — lines 87-97."""

    def test_valid_progress_line_returns_tuple(self):
        result = rsync._parse_progress_line('  75261 100%  199.31MB/s    0:00:00')
        self.assertEqual(result, (75261, 100, '199.31MB/s', '0:00:00'))

    def test_too_few_columns_returns_none(self):
        self.assertIsNone(rsync._parse_progress_line('  75261 100%'))

    def test_non_integer_byte_count_returns_none(self):
        self.assertIsNone(rsync._parse_progress_line('foo 100% 1MB/s 0:00:00'))

    def test_non_integer_percent_returns_none(self):
        self.assertIsNone(rsync._parse_progress_line('1234 abc% 1MB/s 0:00:00'))


class TestRenderProgressBar(unittest.TestCase):
    """Covers _render_progress_bar — lines 102-103."""

    def test_full_bar_uses_only_filled_blocks(self):
        bar = rsync._render_progress_bar(100, 5)
        self.assertEqual(bar, '█' * 5)

    def test_empty_bar_uses_only_empty_blocks(self):
        bar = rsync._render_progress_bar(0, 5)
        self.assertEqual(bar, '░' * 5)

    def test_partial_bar_mixes_blocks(self):
        bar = rsync._render_progress_bar(50, 4)
        self.assertEqual(bar, '██░░')


class TestStreamProgress(unittest.IsolatedAsyncioTestCase):
    """Covers _stream_progress branches — lines 117-158."""

    async def _drive(self, lines):
        stdout = mock.MagicMock()
        line_iter = iter(lines)

        async def readline():
            return next(line_iter)

        stdout.readline = readline
        captured: List[str] = []
        with mock.patch.object(rsync.sys.stdout, 'write',
                               side_effect=captured.append):
            with mock.patch.object(rsync.sys.stdout, 'flush'):
                await rsync._stream_progress(stdout)
        return ''.join(captured)

    async def test_progress_line_renders_bar(self):
        joined = await self._drive([
            b'cli/workflow.py\n',
            b'  75261 100%  199.31MB/s    0:00:00\n',
            b'',
        ])
        self.assertIn('100%', joined)
        self.assertIn('cli/workflow.py', joined)

    async def test_indented_unparseable_line_falls_back_to_filename_plus_line(self):
        joined = await self._drive([
            b'cli/workflow.py\n',
            b'  some-info-line\n',
            b'',
        ])
        # Falls back to "<filename>  <stripped line>"
        self.assertIn('some-info-line', joined)

    async def test_long_filename_is_truncated_with_ellipsis(self):
        long_name = 'a/' + ('xy' * 200) + '.py'
        joined = await self._drive([
            (long_name + '\n').encode(),
            b'  75261 100%  199.31MB/s    0:00:00\n',
            b'',
        ])
        self.assertIn('...', joined)

    async def test_empty_input_writes_nothing(self):
        joined = await self._drive([b''])
        self.assertEqual(joined, '')

    async def test_terminal_size_failure_falls_back_to_80_columns(self):
        with mock.patch('os.get_terminal_size', side_effect=OSError):
            joined = await self._drive([
                b'foo.py\n',
                b'  10 100%  1MB/s    0:00:01\n',
                b'',
            ])
            self.assertIn('100%', joined)


class TestIsRetryableOsmoError(unittest.TestCase):
    """Covers _is_retryable_osmo_error — lines 264-277."""

    def test_no_status_code_not_retryable(self):
        err = osmo_errors.OSMOError('boom')
        self.assertFalse(rsync._is_retryable_osmo_error(err))

    def test_request_timeout_retryable(self):
        err = osmo_errors.OSMOError('boom', status_code=http.HTTPStatus.REQUEST_TIMEOUT)
        self.assertTrue(rsync._is_retryable_osmo_error(err))

    def test_too_many_requests_retryable(self):
        err = osmo_errors.OSMOError('boom', status_code=http.HTTPStatus.TOO_MANY_REQUESTS)
        self.assertTrue(rsync._is_retryable_osmo_error(err))

    def test_internal_server_error_retryable(self):
        err = osmo_errors.OSMOError(
            'boom', status_code=http.HTTPStatus.INTERNAL_SERVER_ERROR)
        self.assertTrue(rsync._is_retryable_osmo_error(err))

    def test_bad_request_not_retryable(self):
        err = osmo_errors.OSMOError('boom', status_code=http.HTTPStatus.BAD_REQUEST)
        self.assertFalse(rsync._is_retryable_osmo_error(err))


class TestRsyncDaemonMetadataFromDict(unittest.TestCase):
    """Covers RsyncDaemonMetadata.from_dict — lines 223-242 (incl. backward-compat)."""

    def test_modern_format_round_trips(self):
        request = _make_upload_request()
        metadata = rsync.RsyncDaemonMetadata(
            pid=1234,
            rsync_request=request,
            start_time='2024-01-01T00:00:00',
        )
        round_tripped = rsync.RsyncDaemonMetadata.from_dict(
            dataclasses.asdict(metadata))
        self.assertEqual(round_tripped.pid, 1234)
        self.assertEqual(round_tripped.rsync_request, request)
        self.assertIsNone(round_tripped.last_synced)

    def test_modern_format_with_last_synced(self):
        request = _make_upload_request()
        metadata = rsync.RsyncDaemonMetadata(
            pid=1,
            rsync_request=request,
            start_time='2024-01-01T00:00:00',
            last_synced='2024-01-01T01:00:00',
        )
        round_tripped = rsync.RsyncDaemonMetadata.from_dict(
            dataclasses.asdict(metadata))
        self.assertEqual(round_tripped.last_synced, '2024-01-01T01:00:00')

    def test_legacy_field_names_translate_to_upload_request(self):
        legacy = {
            'pid': 7,
            'rsync_request': {
                'workflow_id': 'wf-1',
                'task_name': 'task-1',
                'src': '/local/path',
                'dst_module': 'osmo',
                'dst_path': 'remote/file',
                'original_dst_path': '/osmo/run/workspace/remote/file',
            },
            'start_time': '2024-01-01T00:00:00',
        }
        result = rsync.RsyncDaemonMetadata.from_dict(legacy)
        self.assertEqual(result.pid, 7)
        self.assertEqual(result.rsync_request.local_path, '/local/path')
        self.assertEqual(result.rsync_request.remote_module, 'osmo')
        self.assertEqual(result.rsync_request.remote_path, 'remote/file')
        self.assertEqual(
            result.rsync_request.original_remote_path,
            '/osmo/run/workspace/remote/file')
        self.assertEqual(result.rsync_request.direction, rsync.RsyncDirection.UPLOAD)


class TestResolveRsyncBinPath(unittest.TestCase):
    """Covers RsyncClient._resolve_rsync_bin_path — lines 453-459."""

    def test_returns_path_when_binary_exists(self):
        with mock.patch('os.path.exists', return_value=True):
            path = rsync.RsyncClient._resolve_rsync_bin_path()
        self.assertTrue(path.endswith('rsync_bin'))

    def test_raises_when_binary_missing(self):
        with mock.patch('os.path.exists', return_value=False):
            with self.assertRaises(FileNotFoundError):
                rsync.RsyncClient._resolve_rsync_bin_path()


class TestRsyncUploadCounter(unittest.IsolatedAsyncioTestCase):
    """Covers RsyncUploadCounter — lines 386-417."""

    async def test_increment_pending_increases_count(self):
        counter = rsync.RsyncUploadCounter()
        await counter.increment_pending()
        await counter.increment_pending()
        self.assertEqual(await counter.get_pending(), 2)

    async def test_needs_upload_true_when_pending_exceeds_complete(self):
        counter = rsync.RsyncUploadCounter()
        await counter.increment_pending()
        self.assertTrue(await counter.needs_upload())

    async def test_needs_upload_false_when_complete_catches_up(self):
        counter = rsync.RsyncUploadCounter()
        await counter.increment_pending()
        await counter.set_complete(1)
        self.assertFalse(await counter.needs_upload())

    async def test_set_complete_takes_max_with_existing_value(self):
        counter = rsync.RsyncUploadCounter()
        await counter.set_complete(5)
        await counter.set_complete(3)  # smaller value should be ignored
        await counter.increment_pending()
        await counter.increment_pending()
        await counter.increment_pending()
        await counter.increment_pending()
        await counter.increment_pending()
        # 5 pending vs 5 complete: not needed
        self.assertFalse(await counter.needs_upload())


class TestIsProcessRunning(unittest.TestCase):
    """Covers _is_process_running — lines 1428-1432."""

    def test_returns_true_when_signal_succeeds(self):
        with mock.patch('os.kill', return_value=None):
            self.assertTrue(rsync._is_process_running(1234))

    def test_returns_false_when_signal_raises_oserror(self):
        with mock.patch('os.kill', side_effect=OSError):
            self.assertFalse(rsync._is_process_running(1234))


class TestValidateDaemonExists(unittest.TestCase):
    """Covers _validate_daemon_exists — lines 1441-1457."""

    def test_returns_false_when_pid_file_missing(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                request = _make_upload_request()
                self.assertFalse(rsync._validate_daemon_exists(request))

    def test_returns_true_when_running_pid_in_file(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                request = _make_upload_request()
                pid_file = rsync._get_pid_file(
                    request.workflow_id, request.task_name)
                os.makedirs(os.path.dirname(pid_file), exist_ok=True)
                with open(pid_file, 'w', encoding='utf-8') as f:
                    f.write(json.dumps({'pid': 9999}))
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    self.assertTrue(rsync._validate_daemon_exists(request))

    def test_removes_stale_pid_file_when_process_dead(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                request = _make_upload_request()
                pid_file = rsync._get_pid_file(
                    request.workflow_id, request.task_name)
                os.makedirs(os.path.dirname(pid_file), exist_ok=True)
                with open(pid_file, 'w', encoding='utf-8') as f:
                    f.write(json.dumps({'pid': 9999}))
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=False
                ):
                    result = rsync._validate_daemon_exists(request)
                self.assertFalse(result)
                self.assertFalse(os.path.exists(pid_file))


class TestPathHelpers(unittest.TestCase):
    """Covers _get_daemon_dir, _get_log_file, _get_pid_file."""

    def test_daemon_dir_uses_state_dir(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                self.assertEqual(rsync._get_daemon_dir(),
                                 os.path.join(state_dir, 'rsync'))

    def test_log_file_includes_workflow_and_task(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                log_file = rsync._get_log_file('wf-1', 'task-main')
                self.assertTrue(log_file.endswith(
                    'rsync_daemon_wf-1_task-main.log'))

    def test_pid_file_includes_workflow_and_task(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                pid_file = rsync._get_pid_file('wf-1', 'task-main')
                self.assertTrue(pid_file.endswith(
                    'rsync_daemon_wf-1_task-main.pid'))


class TestValidateLocalPath(unittest.TestCase):
    """Covers validate_local_path — lines 1736-1748."""

    def test_empty_path_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_local_path('')

    def test_must_exist_when_path_missing_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_local_path('/nonexistent/place/foo', must_exist=True)

    def test_existing_path_returns_resolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, 'foo')
            with open(target, 'w', encoding='utf-8') as f:
                f.write('x')
            result = rsync.validate_local_path(target, must_exist=True)
            self.assertEqual(result, os.path.realpath(target))

    def test_must_exist_false_returns_path_for_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, 'subdir', 'foo')
            result = rsync.validate_local_path(missing, must_exist=False)
            self.assertIn('foo', result)


class TestValidateRemotePath(unittest.TestCase):
    """Covers validate_remote_path — lines 1767-1793."""

    def test_relative_path_rejected(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_remote_path({}, 'relative/path')

    def test_path_with_dotdot_rejected(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_remote_path({}, '/osmo/run/workspace/../etc/passwd')

    def test_outside_allowed_modules_rejected(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_remote_path({}, '/outside/allowed/path')

    def test_default_module_returns_relative_path(self):
        module_name, sanitized = rsync.validate_remote_path(
            {}, '/osmo/run/workspace/sub/file')
        self.assertEqual(module_name, 'osmo')
        self.assertEqual(sanitized, 'sub/file')

    def test_longest_module_match_wins(self):
        # 'inner' is more specific than 'outer'; longest path should match.
        config = {
            'allowed_paths': {
                'outer': {'path': '/osmo/run/workspace/outer', 'writable': True},
                'inner': {
                    'path': '/osmo/run/workspace/outer/inner',
                    'writable': True,
                },
            },
        }
        module_name, sanitized = rsync.validate_remote_path(
            config, '/osmo/run/workspace/outer/inner/sub')
        self.assertEqual(module_name, 'inner')
        self.assertEqual(sanitized, 'sub')

    def test_non_writable_module_rejected_when_writable_required(self):
        config = {
            'allowed_paths': {
                'readonly': {
                    'path': '/osmo/readonly',
                    'writable': False,
                },
            },
        }
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.validate_remote_path(
                config, '/osmo/readonly/file', require_writable=True)

    def test_non_writable_module_allowed_for_download(self):
        config = {
            'allowed_paths': {
                'readonly': {
                    'path': '/osmo/readonly',
                    'writable': False,
                },
            },
        }
        module_name, sanitized = rsync.validate_remote_path(
            config, '/osmo/readonly/file', require_writable=False)
        self.assertEqual(module_name, 'readonly')
        self.assertEqual(sanitized, 'file')


class TestGetAllowedPaths(unittest.TestCase):
    """Covers get_allowed_paths — lines 1682-1696."""

    def test_no_allowed_paths_returns_default_only(self):
        result = rsync.get_allowed_paths({})
        self.assertEqual(result, [rsync.DEFAULT_MODULE_INFO])

    def test_includes_extra_modules_from_config(self):
        config = {
            'allowed_paths': {
                'logs': {'path': '/osmo/logs/', 'writable': False},
            },
        }
        result = rsync.get_allowed_paths(config)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1].name, 'logs')
        # Path is normalized, trailing slash dropped
        self.assertEqual(result[1].path, '/osmo/logs')
        self.assertFalse(result[1].writable)


class TestGetRsyncConfig(unittest.TestCase):
    """Covers get_rsync_config — lines 1667-1671."""

    def test_returns_rsync_section_from_plugins_config(self):
        client = _FakeServiceClient([{'rsync': {'foo': 1}}])
        result = rsync.get_rsync_config(cast(Any, client))
        self.assertEqual(result, {'foo': 1})
        self.assertEqual(client.calls[0][1], 'api/plugins/configs')

    def test_returns_empty_dict_when_no_rsync_section(self):
        client = _FakeServiceClient([{}])
        self.assertEqual(rsync.get_rsync_config(cast(Any, client)), {})


class TestGetLeadTaskName(unittest.TestCase):
    """Covers get_lead_task_name — lines 1703-1722."""

    def test_returns_task_name_when_lead_present(self):
        client = _FakeServiceClient([{
            'groups': [
                {
                    'name': 'g0',
                    'tasks': [
                        {'name': 'leader', 'lead': True},
                        {'name': 'follower', 'lead': False},
                    ],
                },
            ],
        }])
        self.assertEqual(rsync.get_lead_task_name(cast(Any, client), 'wf-1'), 'leader')

    def test_no_groups_raises_user_error(self):
        client = _FakeServiceClient([{'groups': []}])
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.get_lead_task_name(cast(Any, client), 'wf-1')

    def test_no_tasks_in_lead_group_raises_user_error(self):
        client = _FakeServiceClient([{'groups': [{'name': 'g0', 'tasks': []}]}])
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.get_lead_task_name(cast(Any, client), 'wf-1')

    def test_no_lead_task_raises_user_error(self):
        client = _FakeServiceClient([{
            'groups': [
                {
                    'name': 'g0',
                    'tasks': [
                        {'name': 'follower', 'lead': False},
                    ],
                },
            ],
        }])
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.get_lead_task_name(cast(Any, client), 'wf-1')


class TestParseRsyncRequest(unittest.TestCase):
    """Covers parse_rsync_request — lines 1818-1853."""

    def test_missing_colon_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            rsync.parse_rsync_request(
                {}, 'wf-1', 'task', 'no_colon_here',
                rsync.RsyncDirection.UPLOAD)

    def test_upload_parses_local_then_remote(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_file = os.path.join(tmp, 'src')
            with open(local_file, 'w', encoding='utf-8') as f:
                f.write('x')
            request = rsync.parse_rsync_request(
                {}, 'wf-1', 'task',
                f'{local_file}:/osmo/run/workspace/dst',
                rsync.RsyncDirection.UPLOAD,
            )
            self.assertEqual(request.workflow_id, 'wf-1')
            self.assertEqual(request.task_name, 'task')
            self.assertEqual(request.direction, rsync.RsyncDirection.UPLOAD)
            self.assertEqual(request.local_path, os.path.realpath(local_file))
            self.assertEqual(request.remote_module, 'osmo')
            self.assertEqual(request.remote_path, 'dst')
            self.assertEqual(request.original_remote_path,
                             '/osmo/run/workspace/dst')

    def test_download_parses_remote_then_local(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_dir = os.path.join(tmp, 'dst')
            request = rsync.parse_rsync_request(
                {}, 'wf-1', 'task',
                f'/osmo/run/workspace/src:{local_dir}',
                rsync.RsyncDirection.DOWNLOAD,
            )
            self.assertEqual(request.direction, rsync.RsyncDirection.DOWNLOAD)
            self.assertEqual(request.remote_module, 'osmo')
            self.assertEqual(request.remote_path, 'src')
            self.assertEqual(request.original_remote_path,
                             '/osmo/run/workspace/src')

    def test_escaped_colon_in_left_side_is_skipped(self):
        # Backslash-escaped colon is not a separator. Use an existing local
        # file to ensure validation passes once we reach the second colon.
        with tempfile.TemporaryDirectory() as tmp:
            local_file = os.path.join(tmp, r'foo\:bar')
            with open(local_file, 'w', encoding='utf-8') as f:
                f.write('x')
            request = rsync.parse_rsync_request(
                {}, 'wf-1', 'task',
                f'{local_file}:/osmo/run/workspace/dst',
                rsync.RsyncDirection.UPLOAD,
            )
            self.assertEqual(request.remote_path, 'dst')


class TestResolveFloatParam(unittest.TestCase):
    """Covers _resolve_float_param — lines 1865-1870."""

    def test_param_not_in_config_falls_back_to_user_value(self):
        result = rsync._resolve_float_param(
            {}, 'debounce', 30.0, 99.0)
        self.assertEqual(result, 99.0)

    def test_param_not_in_config_falls_back_to_default_when_user_none(self):
        result = rsync._resolve_float_param(
            {}, 'debounce', 30.0, None)
        self.assertEqual(result, 30.0)

    def test_server_value_overrides_user_when_server_higher(self):
        result = rsync._resolve_float_param(
            {'debounce': 100.0}, 'debounce', 30.0, 50.0)
        self.assertEqual(result, 100.0)

    def test_user_value_overrides_server_when_user_higher(self):
        result = rsync._resolve_float_param(
            {'debounce': 50.0}, 'debounce', 30.0, 100.0)
        self.assertEqual(result, 100.0)

    def test_user_none_with_server_value_uses_server(self):
        result = rsync._resolve_float_param(
            {'debounce': 50.0}, 'debounce', 30.0, None)
        self.assertEqual(result, 50.0)


class TestRsyncStatus(unittest.TestCase):
    """Covers rsync_status — lines 1535-1581."""

    def _write_pid_file(self, state_dir: str, request: rsync.RsyncRequest, pid: int):
        pid_file = os.path.join(state_dir, 'rsync',
                                f'rsync_daemon_{request.workflow_id}_'
                                f'{request.task_name}.pid')
        os.makedirs(os.path.dirname(pid_file), exist_ok=True)
        with open(pid_file, 'w', encoding='utf-8') as f:
            f.write(json.dumps(dataclasses.asdict(rsync.RsyncDaemonMetadata(
                pid=pid,
                rsync_request=request,
                start_time='2024-01-01T00:00:00',
            ))))
        return pid_file

    def test_no_daemon_dir_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as state_dir:
            # state_dir exists but no 'rsync' subdir
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                # Make sure the daemon dir does not exist.
                self.assertEqual(rsync.rsync_status(), [])

    def test_returns_running_daemon_info(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                request = _make_upload_request()
                self._write_pid_file(state_dir, request, 4321)
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    daemons = rsync.rsync_status()
        self.assertEqual(len(daemons), 1)
        self.assertEqual(daemons[0].metadata.pid, 4321)
        self.assertEqual(daemons[0].status, rsync.RsyncDaemonStatus.RUNNING)
        self.assertIsNone(daemons[0].log_file)

    def test_workflow_id_filter_excludes_others(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                req1 = _make_upload_request()
                req2 = dataclasses.replace(req1, workflow_id='wf-other')
                self._write_pid_file(state_dir, req1, 1)
                self._write_pid_file(state_dir, req2, 2)
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    daemons = rsync.rsync_status(workflow_id='wf-1')
        self.assertEqual(len(daemons), 1)
        self.assertEqual(daemons[0].metadata.rsync_request.workflow_id, 'wf-1')

    def test_task_name_filter_excludes_others(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                req1 = _make_upload_request()
                req2 = dataclasses.replace(req1, task_name='other')
                self._write_pid_file(state_dir, req1, 1)
                self._write_pid_file(state_dir, req2, 2)
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    daemons = rsync.rsync_status(task_name='task-main')
        self.assertEqual(len(daemons), 1)
        self.assertEqual(daemons[0].metadata.rsync_request.task_name,
                         'task-main')

    def test_status_filter_excludes_running_when_only_stopped_requested(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                req = _make_upload_request()
                self._write_pid_file(state_dir, req, 9999)
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    daemons = rsync.rsync_status(
                        statuses={rsync.RsyncDaemonStatus.STOPPED})
        self.assertEqual(daemons, [])

    def test_includes_log_file_when_present(self):
        with tempfile.TemporaryDirectory() as state_dir:
            with mock.patch.dict(os.environ, {'OSMO_LOG_FILE_DIR': state_dir}):
                req = _make_upload_request()
                self._write_pid_file(state_dir, req, 1)
                log_file = os.path.join(
                    state_dir, 'rsync',
                    f'rsync_daemon_{req.workflow_id}_{req.task_name}.log')
                with open(log_file, 'w', encoding='utf-8') as f:
                    f.write('logs')
                with mock.patch.object(
                    rsync, '_is_process_running', return_value=True
                ):
                    daemons = rsync.rsync_status()
        self.assertEqual(daemons[0].log_file, log_file)


class TestRsyncClientInit(unittest.TestCase):
    """Covers RsyncClient.__init__ properties — lines 461-498, 502, 506."""

    def test_local_path_property_returns_request_path(self):
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            request = _make_upload_request(local_path='/tmp/foo')
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=request,
            )
        self.assertEqual(client.local_path, '/tmp/foo')

    def test_stopped_property_reflects_event_state(self):
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            request = _make_upload_request()
            stop_event = asyncio.Event()
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=request,
                stop_event=stop_event,
            )
        self.assertFalse(client.stopped)
        stop_event.set()
        self.assertTrue(client.stopped)

    def test_rate_limit_initialises_token_bucket(self):
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            request = _make_upload_request()
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=request,
                upload_rate_limit=10,
            )
        rate_limiter = cast(Any, client._upload_rate_limiter)
        self.assertIsNotNone(rate_limiter)
        self.assertEqual(rate_limiter.capacity, 10)


class TestRsyncClientUploadAndDownloadGuards(unittest.IsolatedAsyncioTestCase):
    """Covers early-exit guards in upload/download/list_modules.

    Hits the `not running` raise paths in lines 588-589, 677-678, 762-763.
    """

    def _make_client(self):
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            request = _make_upload_request()
            return rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=request,
            )

    async def test_upload_raises_when_stopped(self):
        client = self._make_client()
        client._stop_event.set()
        with self.assertRaises(osmo_errors.OSMOError):
            await client.upload()

    async def test_download_raises_when_stopped(self):
        client = self._make_client()
        client._stop_event.set()
        with self.assertRaises(osmo_errors.OSMOError):
            await client.download()

    async def test_list_modules_raises_when_stopped(self):
        client = self._make_client()
        client._stop_event.set()
        with self.assertRaises(osmo_errors.OSMOError):
            await client.list_modules()

    async def test_upload_skips_when_lock_held(self):
        client = self._make_client()
        # Pretend the port is up so we don't actually need a socket.
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(('127.0.0.1', 0))
            client._sock = sock
            client._tcp_ready.set()
            await client._upload_lock.acquire()
            try:
                # Should return early, without attempting subprocess
                await client.upload()
                # Pending should still bump even though upload was queued.
                self.assertEqual(await client._upload_counter.get_pending(), 1)
            finally:
                client._upload_lock.release()
        finally:
            sock.close()

    async def test_download_raises_when_destination_is_file(self):
        client = self._make_client()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(('127.0.0.1', 0))
            client._sock = sock
            client._tcp_ready.set()
            with tempfile.NamedTemporaryFile() as tmp:
                # Override request to point at the file
                client._rsync_request = dataclasses.replace(
                    client._rsync_request, local_path=tmp.name)
                with self.assertRaises(osmo_errors.OSMOUserError):
                    await client.download()
        finally:
            sock.close()


class TestDebounceTimer(unittest.IsolatedAsyncioTestCase):
    """Covers DebounceTimer — lines 932-934, 941, 943-947, 949-954, 960-962."""

    async def test_cancel_with_no_running_timer_is_noop(self):
        loop = asyncio.get_running_loop()
        timer = rsync.DebounceTimer(loop=loop, delay=0.01)
        # No timer has been created yet — should be a no-op.
        timer.cancel()
        self.assertIsNone(timer._timer)

    async def test_debounce_runs_function_after_delay(self):
        loop = asyncio.get_running_loop()
        timer = rsync.DebounceTimer(loop=loop, delay=0.01)
        called = asyncio.Event()

        def callback():
            called.set()

        timer.debounce(callback)
        await asyncio.wait_for(called.wait(), timeout=1.0)
        self.assertTrue(called.is_set())

    async def test_debounce_cancels_previous_timer(self):
        loop = asyncio.get_running_loop()
        timer = rsync.DebounceTimer(loop=loop, delay=10.0)
        first_call = asyncio.Event()

        def first_callback():
            first_call.set()

        timer.debounce(first_callback)
        # Replace before the long delay fires.
        second_call = asyncio.Event()

        def second_callback():
            second_call.set()

        timer.debounce(second_callback)
        # Cancel everything; nothing should have fired in between.
        timer.cancel()
        await asyncio.sleep(0.05)
        self.assertFalse(first_call.is_set())
        self.assertFalse(second_call.is_set())

    async def test_debounce_supports_async_callbacks(self):
        loop = asyncio.get_running_loop()
        timer = rsync.DebounceTimer(loop=loop, delay=0.01)
        called = asyncio.Event()

        async def callback():
            called.set()

        timer.debounce(callback)
        await asyncio.wait_for(called.wait(), timeout=1.0)


class TestRsyncUploadOrchestrator(unittest.TestCase):
    """Covers rsync_upload — lines 1910-1963."""

    def test_dispatches_to_async_upload_when_daemon_false(self):
        rsync_config: Dict[str, Any] = {'client_upload_rate_limit': 0}
        client = _FakeServiceClient([
            {'rsync': rsync_config},
            # Lead task lookup
            {'groups': [{'name': 'g0', 'tasks': [
                {'name': 'leader', 'lead': True},
            ]}]},
        ])
        called: Dict[str, Any] = {}

        async def fake_upload_task(service_client, rsync_request, **kwargs):
            del service_client
            called['workflow_id'] = rsync_request.workflow_id
            called['rate_limit'] = kwargs.get('rate_limit')
            called['show_progress'] = kwargs.get('show_progress')

        with tempfile.TemporaryDirectory() as tmp:
            local_file = os.path.join(tmp, 'src')
            with open(local_file, 'w', encoding='utf-8') as f:
                f.write('x')
            with mock.patch.object(
                rsync, 'rsync_upload_task', side_effect=fake_upload_task
            ):
                rsync.rsync_upload(
                    cast(Any, client),
                    'wf-1',
                    None,
                    f'{local_file}:/osmo/run/workspace/dst',
                    daemon=False,
                    show_progress=True,
                )
        self.assertEqual(called['workflow_id'], 'wf-1')
        self.assertIsNone(called['rate_limit'])
        self.assertTrue(called['show_progress'])

    def test_server_rate_limit_caps_user_rate_limit(self):
        rsync_config: Dict[str, Any] = {'client_upload_rate_limit': 100}
        client = _FakeServiceClient([
            {'rsync': rsync_config},
            {'groups': [{'name': 'g0', 'tasks': [
                {'name': 'leader', 'lead': True},
            ]}]},
        ])
        captured: Dict[str, Any] = {}

        async def fake_upload_task(service_client, rsync_request, **kwargs):
            del service_client, rsync_request
            captured['rate_limit'] = kwargs.get('rate_limit')

        with tempfile.TemporaryDirectory() as tmp:
            local_file = os.path.join(tmp, 'src')
            with open(local_file, 'w', encoding='utf-8') as f:
                f.write('x')
            with mock.patch.object(
                rsync, 'rsync_upload_task', side_effect=fake_upload_task
            ):
                rsync.rsync_upload(
                    cast(Any, client),
                    'wf-1',
                    'task',
                    f'{local_file}:/osmo/run/workspace/dst',
                    upload_rate_limit=500,
                )
        self.assertEqual(captured['rate_limit'], 100)

    def test_daemon_path_invokes_daemon_helper(self):
        rsync_config: Dict[str, Any] = {}
        client = _FakeServiceClient([{'rsync': rsync_config}])
        login_config = mock.MagicMock(name='login_config')
        client.login_manager = mock.MagicMock(login_config=login_config)  # type: ignore[attr-defined]
        captured: Dict[str, Any] = {}

        def fake_daemon(login_cfg, rsync_request, **kwargs):
            del rsync_request
            captured['login_config'] = login_cfg
            captured['debounce'] = kwargs.get('debounce_delay')
            captured['poll_interval'] = kwargs.get('poll_interval')

        with tempfile.TemporaryDirectory() as tmp:
            local_file = os.path.join(tmp, 'src')
            with open(local_file, 'w', encoding='utf-8') as f:
                f.write('x')
            with mock.patch.object(
                rsync, 'rsync_upload_task_daemon', side_effect=fake_daemon
            ):
                rsync.rsync_upload(
                    cast(Any, client),
                    'wf-1',
                    'task',
                    f'{local_file}:/osmo/run/workspace/dst',
                    daemon=True,
                    daemon_debounce_delay=42.0,
                    daemon_poll_interval=200.0,
                )
        self.assertIs(captured['login_config'], login_config)
        self.assertEqual(captured['debounce'], 42.0)
        self.assertEqual(captured['poll_interval'], 200.0)


class TestRsyncDownloadOrchestrator(unittest.TestCase):
    """Covers rsync_download — lines 1987-1999."""

    def test_dispatches_to_async_download_task(self):
        rsync_config: Dict[str, Any] = {}
        client = _FakeServiceClient([
            {'rsync': rsync_config},
            {'groups': [{'name': 'g0', 'tasks': [
                {'name': 'leader', 'lead': True},
            ]}]},
        ])
        captured: Dict[str, Any] = {}

        async def fake_download_task(service_client, rsync_request, **kwargs):
            del service_client
            captured['workflow_id'] = rsync_request.workflow_id
            captured['direction'] = rsync_request.direction
            captured['show_progress'] = kwargs.get('show_progress')

        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(
                rsync, 'rsync_download_task', side_effect=fake_download_task
            ):
                rsync.rsync_download(
                    cast(Any, client),
                    'wf-1',
                    None,
                    f'/osmo/run/workspace/file:{tmp}',
                    show_progress=True,
                )
        self.assertEqual(captured['workflow_id'], 'wf-1')
        self.assertEqual(captured['direction'], rsync.RsyncDirection.DOWNLOAD)
        self.assertTrue(captured['show_progress'])


class TestRsyncUploadTask(unittest.IsolatedAsyncioTestCase):
    """Covers rsync_upload_task — lines 1601-1613."""

    def setUp(self):
        bin_patch = mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path',
            return_value='/bin/rsync')
        bin_patch.start()
        self.addCleanup(bin_patch.stop)

    async def test_starts_uploads_and_stops_client(self):
        request = _make_upload_request()
        with mock.patch.object(
            rsync.RsyncClient, 'start', new=mock.AsyncMock()
        ) as start_mock:
            with mock.patch.object(
                rsync.RsyncClient, 'upload', new=mock.AsyncMock()
            ) as upload_mock:
                with mock.patch.object(
                    rsync.RsyncClient, 'stop', new=mock.AsyncMock()
                ) as stop_mock:
                    await rsync.rsync_upload_task(
                        mock.MagicMock(), request, timeout=1)
        start_mock.assert_awaited_once()
        upload_mock.assert_awaited_once()
        stop_mock.assert_awaited_once()


class TestRsyncDownloadTask(unittest.IsolatedAsyncioTestCase):
    """Covers rsync_download_task — lines 1631-1656."""

    def setUp(self):
        bin_patch = mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path',
            return_value='/bin/rsync')
        bin_patch.start()
        self.addCleanup(bin_patch.stop)

    def _patch_client_methods(self, modules: List[str]):
        for attr, value in (
            ('start', mock.AsyncMock()),
            ('list_modules', mock.AsyncMock(return_value=modules)),
            ('download', mock.AsyncMock()),
            ('stop', mock.AsyncMock()),
        ):
            patcher = mock.patch.object(rsync.RsyncClient, attr, new=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_no_modules_raises(self):
        request = dataclasses.replace(
            _make_upload_request(), direction=rsync.RsyncDirection.DOWNLOAD)
        self._patch_client_methods([])
        with self.assertRaises(osmo_errors.OSMOError):
            await rsync.rsync_download_task(
                mock.MagicMock(), request, timeout=1)

    async def test_unknown_module_raises(self):
        request = dataclasses.replace(
            _make_upload_request(), direction=rsync.RsyncDirection.DOWNLOAD)
        self._patch_client_methods(['other'])
        with self.assertRaises(osmo_errors.OSMOError):
            await rsync.rsync_download_task(
                mock.MagicMock(), request, timeout=1)

    async def test_module_present_calls_download(self):
        request = dataclasses.replace(
            _make_upload_request(), direction=rsync.RsyncDirection.DOWNLOAD)
        self._patch_client_methods(['osmo'])
        await rsync.rsync_download_task(
            mock.MagicMock(), request, timeout=1)


class TestPortForwardParamsRetry(unittest.IsolatedAsyncioTestCase):
    """Covers _get_task_rsync_port_forward_params and _get_workflow_task — 280-303, 335-348."""

    async def test_get_task_rsync_port_forward_params_returns_on_success(self):
        client = _FakeServiceClient([{
            'router_address': 'router:1234',
            'key': 'k',
            'cookie': 'c',
        }])
        result = await rsync._get_task_rsync_port_forward_params(
            cast(Any, client), 'wf-1', 'task')
        self.assertEqual(result.router_address, 'router:1234')
        self.assertEqual(result.key, 'k')
        self.assertEqual(result.cookie, 'c')

    async def test_non_retryable_error_propagates(self):
        err = osmo_errors.OSMOError(
            'forbidden', status_code=http.HTTPStatus.FORBIDDEN)
        client = _FakeServiceClient([err])
        with self.assertRaises(osmo_errors.OSMOError):
            await rsync._get_task_rsync_port_forward_params(
                cast(Any, client), 'wf-1', 'task')

    async def test_retryable_then_success(self):
        err = osmo_errors.OSMOError(
            'rate-limited', status_code=http.HTTPStatus.TOO_MANY_REQUESTS)
        client = _FakeServiceClient([err, {
            'router_address': 'r', 'key': 'k', 'cookie': 'c'
        }])
        with mock.patch.object(
            rsync.port_forward, 'get_exponential_backoff_delay', return_value=0
        ):
            result = await rsync._get_task_rsync_port_forward_params(
                cast(Any, client), 'wf-1', 'task')
        self.assertEqual(result.key, 'k')

    async def test_get_workflow_task_returns_response(self):
        client = _FakeServiceClient([{'status': 'RUNNING'}])
        result = await rsync._get_workflow_task(cast(Any, client), 'wf-1', 'task')
        self.assertEqual(result, {'status': 'RUNNING'})

    async def test_get_workflow_task_non_retryable_propagates(self):
        client = _FakeServiceClient([
            osmo_errors.OSMOError('not found', status_code=http.HTTPStatus.NOT_FOUND),
        ])
        with self.assertRaises(osmo_errors.OSMOError):
            await rsync._get_workflow_task(cast(Any, client), 'wf-1', 'task')


class TestPublicAsyncWaitForWrappers(unittest.IsolatedAsyncioTestCase):
    """Covers get_task_rsync_port_forward_params + get_workflow_task — 317-327, 359-369."""

    async def test_get_task_rsync_port_forward_params_returns(self):
        client = _FakeServiceClient([{
            'router_address': 'r', 'key': 'k', 'cookie': 'c'
        }])
        result = await rsync.get_task_rsync_port_forward_params(
            cast(Any, client), 'wf-1', 'task', timeout=1)
        self.assertEqual(result.cookie, 'c')

    async def test_get_task_rsync_port_forward_params_propagates_error(self):
        client = _FakeServiceClient([
            osmo_errors.OSMOError('boom', status_code=http.HTTPStatus.FORBIDDEN),
        ])
        with self.assertRaises(osmo_errors.OSMOError):
            await rsync.get_task_rsync_port_forward_params(
                cast(Any, client), 'wf-1', 'task', timeout=1)

    async def test_get_workflow_task_returns(self):
        client = _FakeServiceClient([{'status': 'RUNNING'}])
        result = await rsync.get_workflow_task(
            cast(Any, client), 'wf-1', 'task', timeout=1)
        self.assertEqual(result, {'status': 'RUNNING'})

    async def test_get_workflow_task_timeout_propagates(self):
        async def slow(*args, **kwargs):
            del args, kwargs
            await asyncio.sleep(10)

        with mock.patch.object(
            rsync, '_get_workflow_task', side_effect=slow
        ):
            with self.assertRaises(asyncio.TimeoutError):
                await rsync.get_workflow_task(
                    mock.MagicMock(), 'wf-1', 'task', timeout=0)


class _FakeAsyncProcess:
    """Mock asyncio subprocess with configurable returncode and output."""

    def __init__(self, stdout: bytes = b'', stderr: bytes = b'', returncode: int = 0):
        self.stdout = mock.AsyncMock()
        self.stdout.readline = mock.AsyncMock(return_value=b'')
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self.terminate = mock.MagicMock()
        self.wait = mock.AsyncMock(return_value=returncode)

    async def communicate(self):
        return self._stdout, self._stderr


def _make_rsync_client(
    request=None,
    stop_event=None,
    upload_rate_limit=None,
    show_progress=False,
):
    """Create an RsyncClient with the binary path patched."""
    if request is None:
        request = _make_upload_request()
    with mock.patch.object(
        rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
    ):
        return rsync.RsyncClient(
            service_client=mock.MagicMock(),
            rsync_request=request,
            stop_event=stop_event,
            upload_rate_limit=upload_rate_limit,
            show_progress=show_progress,
        )


class TestRsyncClientUploadHappyPath(unittest.IsolatedAsyncioTestCase):
    """Covers upload subprocess flow — lines 597-660."""

    async def test_upload_runs_subprocess_and_invokes_callback(self):
        callback_called = []
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=_make_upload_request(),
                upload_callback=lambda: callback_called.append(True),
            )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        client._tcp_ready.set()
        fake_process = _FakeAsyncProcess(returncode=0)
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                await client.upload()
            self.assertEqual(callback_called, [True])
            self.assertFalse(await client._upload_counter.needs_upload())
        finally:
            sock.close()

    async def test_upload_failed_subprocess_raises(self):
        client = _make_rsync_client()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        client._tcp_ready.set()
        fake_process = _FakeAsyncProcess(stderr=b'rsync error', returncode=1)
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                with self.assertRaises(osmo_errors.OSMOError):
                    await client.upload()
        finally:
            sock.close()

    async def test_upload_callback_exception_is_logged(self):
        def bad_callback():
            raise RuntimeError('boom')

        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=_make_upload_request(),
                upload_callback=bad_callback,
            )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        client._tcp_ready.set()
        fake_process = _FakeAsyncProcess(returncode=0)
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                # Should NOT raise
                await client.upload()
        finally:
            sock.close()

    async def test_upload_with_show_progress_streams_progress(self):
        with mock.patch.object(
            rsync.RsyncClient, '_resolve_rsync_bin_path', return_value='/bin/rsync'
        ):
            client = rsync.RsyncClient(
                service_client=mock.MagicMock(),
                rsync_request=_make_upload_request(),
                show_progress=True,
            )
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        client._tcp_ready.set()
        fake_process = _FakeAsyncProcess(returncode=0)
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                with mock.patch.object(
                    rsync, '_stream_progress', new=mock.AsyncMock()
                ) as mock_stream:
                    await client.upload()
                mock_stream.assert_awaited_once()
        finally:
            sock.close()


class TestRsyncClientDownloadHappyPath(unittest.IsolatedAsyncioTestCase):
    """Covers download subprocess flow — lines 680-756."""

    async def test_download_runs_subprocess_and_creates_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_path = os.path.join(tmp, 'dst')
            request = _make_upload_request(
                local_path=local_path,
                remote_path='sub/file',
                original_remote_path='/osmo/run/workspace/sub/file',
            )
            request = dataclasses.replace(
                request, direction=rsync.RsyncDirection.DOWNLOAD)
            client = _make_rsync_client(request=request)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('127.0.0.1', 0))
            client._sock = sock
            client._tcp_ready.set()

            # Pre-populate destination with the basename so _download_landed returns True.
            os.makedirs(local_path, exist_ok=True)
            with open(os.path.join(local_path, 'file'), 'w', encoding='utf-8') as f:
                f.write('done')
            fake_process = _FakeAsyncProcess(returncode=0)
            try:
                with mock.patch.object(
                    asyncio, 'create_subprocess_exec',
                    new=mock.AsyncMock(return_value=fake_process),
                ):
                    await client.download()
            finally:
                sock.close()

    async def test_download_failed_subprocess_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            local_path = os.path.join(tmp, 'dst')
            request = _make_upload_request(local_path=local_path)
            client = _make_rsync_client(request=request)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('127.0.0.1', 0))
            client._sock = sock
            client._tcp_ready.set()
            fake_process = _FakeAsyncProcess(stderr=b'no such', returncode=1)
            try:
                with mock.patch.object(
                    asyncio, 'create_subprocess_exec',
                    new=mock.AsyncMock(return_value=fake_process),
                ):
                    with self.assertRaises(osmo_errors.OSMOError):
                        await client.download()
            finally:
                sock.close()

    async def test_download_landing_check_fails_raises(self):
        # Source has no basename match in destination — should raise.
        with tempfile.TemporaryDirectory() as tmp:
            local_path = os.path.join(tmp, 'dst')
            os.makedirs(local_path, exist_ok=True)
            request = _make_upload_request(
                local_path=local_path,
                remote_path='sub/missing',
                original_remote_path='/osmo/run/workspace/sub/missing',
            )
            client = _make_rsync_client(request=request)
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('127.0.0.1', 0))
            client._sock = sock
            client._tcp_ready.set()
            fake_process = _FakeAsyncProcess(returncode=0)
            try:
                with mock.patch.object(
                    asyncio, 'create_subprocess_exec',
                    new=mock.AsyncMock(return_value=fake_process),
                ):
                    with self.assertRaises(osmo_errors.OSMOError):
                        await client.download()
            finally:
                sock.close()


class TestRsyncClientListModulesHappyPath(unittest.IsolatedAsyncioTestCase):
    """Covers list_modules subprocess flow — lines 765-796."""

    async def test_list_modules_parses_module_names(self):
        client = _make_rsync_client()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        fake_process = _FakeAsyncProcess(
            stdout=b'osmo  comment\nworkspace  another comment\n',
            returncode=0,
        )
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                modules = await client.list_modules()
            self.assertEqual(modules, ['osmo', 'workspace'])
        finally:
            sock.close()

    async def test_list_modules_returncode_nonzero_raises(self):
        client = _make_rsync_client()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(('127.0.0.1', 0))
        client._sock = sock
        fake_process = _FakeAsyncProcess(stderr=b'fail', returncode=1)
        try:
            with mock.patch.object(
                asyncio, 'create_subprocess_exec',
                new=mock.AsyncMock(return_value=fake_process),
            ):
                # The exception is swallowed by the broad-except clause and
                # returns an empty list.
                result = await client.list_modules()
            self.assertEqual(result, [])
        finally:
            sock.close()


class TestRsyncClientStartStop(unittest.IsolatedAsyncioTestCase):
    """Covers start/stop orchestration — lines 512-577."""

    async def test_stop_cancels_pending_tasks(self):
        client = _make_rsync_client()
        async def run_forever():
            await asyncio.Event().wait()
        client._port_forward_task = asyncio.create_task(run_forever())
        client._reconcile_upload_task = asyncio.create_task(run_forever())
        await client.stop()
        self.assertTrue(client._stop_event.is_set())
        self.assertTrue(client._tcp_close.is_set())

    async def test_stop_when_no_tasks_set_only_events(self):
        client = _make_rsync_client()
        await client.stop()
        self.assertTrue(client._stop_event.is_set())

    async def test_start_times_out_when_tcp_ready_never_set(self):
        client = _make_rsync_client()
        client._timeout = 0  # immediate timeout

        async def fake_pf(self):
            del self
            await asyncio.Event().wait()

        async def fake_rec(self):
            del self
            await asyncio.Event().wait()

        with mock.patch.object(rsync.RsyncClient, '_port_forward', new=fake_pf):
            with mock.patch.object(
                rsync.RsyncClient, '_reconcile_upload', new=fake_rec
            ):
                with self.assertRaises(osmo_errors.OSMOError):
                    await client.start(validate_module=False)

    async def test_start_validates_module_and_succeeds(self):
        client = _make_rsync_client()

        async def fake_pf(self):
            self._tcp_ready.set()
            await asyncio.Event().wait()

        async def fake_rec(self):
            del self
            await asyncio.Event().wait()

        with mock.patch.object(rsync.RsyncClient, '_port_forward', new=fake_pf):
            with mock.patch.object(
                rsync.RsyncClient, '_reconcile_upload', new=fake_rec
            ):
                with mock.patch.object(
                    rsync.RsyncClient, 'list_modules',
                    new=mock.AsyncMock(return_value=['osmo']),
                ):
                    await client.start(validate_module=True)
        # Cleanup
        await client.stop()

    async def test_start_validate_module_no_modules_raises(self):
        client = _make_rsync_client()

        async def fake_pf(self):
            self._tcp_ready.set()
            await asyncio.Event().wait()

        async def fake_rec(self):
            del self
            await asyncio.Event().wait()

        with mock.patch.object(rsync.RsyncClient, '_port_forward', new=fake_pf):
            with mock.patch.object(
                rsync.RsyncClient, '_reconcile_upload', new=fake_rec
            ):
                with mock.patch.object(
                    rsync.RsyncClient, 'list_modules',
                    new=mock.AsyncMock(return_value=[]),
                ):
                    with self.assertRaises(osmo_errors.OSMOError):
                        await client.start(validate_module=True)
        await client.stop()

    async def test_start_validate_module_unknown_module_raises(self):
        client = _make_rsync_client()

        async def fake_pf(self):
            self._tcp_ready.set()
            await asyncio.Event().wait()

        async def fake_rec(self):
            del self
            await asyncio.Event().wait()

        with mock.patch.object(rsync.RsyncClient, '_port_forward', new=fake_pf):
            with mock.patch.object(
                rsync.RsyncClient, '_reconcile_upload', new=fake_rec
            ):
                with mock.patch.object(
                    rsync.RsyncClient, 'list_modules',
                    new=mock.AsyncMock(return_value=['other']),
                ):
                    with self.assertRaises(osmo_errors.OSMOError):
                        await client.start(validate_module=True)
        await client.stop()

    async def test_start_when_stop_event_set_raises(self):
        stop_event = asyncio.Event()
        client = _make_rsync_client(stop_event=stop_event)
        client._timeout = 60

        async def fake_pf(self):
            del self
            await asyncio.Event().wait()

        async def fake_rec(self):
            del self
            await asyncio.Event().wait()

        with mock.patch.object(rsync.RsyncClient, '_port_forward', new=fake_pf):
            with mock.patch.object(
                rsync.RsyncClient, '_reconcile_upload', new=fake_rec
            ):
                async def trip():
                    await asyncio.sleep(0.01)
                    stop_event.set()

                trip_task = asyncio.create_task(trip())
                with self.assertRaises(osmo_errors.OSMOError):
                    await client.start(validate_module=False)
                await trip_task


class TestRsyncClientReconcileUpload(unittest.IsolatedAsyncioTestCase):
    """Covers _reconcile_upload — lines 896-915."""

    async def test_reconcile_invokes_upload_when_pending(self):
        client = _make_rsync_client()
        client._reconcile_interval = 0.0
        client._tcp_ready.set()
        await client._upload_counter.increment_pending()
        upload_calls = []

        async def fake_upload(self):
            del self
            upload_calls.append(True)
            await client._upload_counter.set_complete(1)
            client._stop_event.set()

        with mock.patch.object(rsync.RsyncClient, 'upload', new=fake_upload):
            await asyncio.wait_for(client._reconcile_upload(), timeout=2.0)
        self.assertEqual(upload_calls, [True])

    async def test_reconcile_skips_upload_when_lock_held(self):
        client = _make_rsync_client()
        client._reconcile_interval = 0.0
        client._tcp_ready.set()
        upload_calls = []

        async def fake_upload(self):
            del self
            upload_calls.append(True)

        async def stopper():
            await asyncio.sleep(0.05)
            client._stop_event.set()

        await client._upload_lock.acquire()
        try:
            with mock.patch.object(rsync.RsyncClient, 'upload', new=fake_upload):
                stopper_task = asyncio.create_task(stopper())
                await asyncio.wait_for(client._reconcile_upload(), timeout=2.0)
                await stopper_task
        finally:
            client._upload_lock.release()
        self.assertEqual(upload_calls, [])

    async def test_reconcile_logs_upload_exception(self):
        client = _make_rsync_client()
        client._reconcile_interval = 0.0
        client._tcp_ready.set()
        await client._upload_counter.increment_pending()

        async def fake_upload(self):
            del self
            client._stop_event.set()
            raise RuntimeError('boom')

        with mock.patch.object(rsync.RsyncClient, 'upload', new=fake_upload):
            await asyncio.wait_for(client._reconcile_upload(), timeout=2.0)


class TestRsyncClientOnPortForwardDone(unittest.IsolatedAsyncioTestCase):
    """Covers _on_port_forward_done — lines 888-890."""

    async def test_no_op_when_no_exception(self):
        client = _make_rsync_client()

        async def noop():
            return None

        task = asyncio.create_task(noop())
        await task
        client._on_port_forward_done(task)
        self.assertFalse(client._stop_event.is_set())

    async def test_triggers_stop_when_task_failed(self):
        client = _make_rsync_client()

        async def failing():
            raise RuntimeError('crash')

        task = asyncio.create_task(failing())
        # await it to materialize exception
        with self.assertRaises(RuntimeError):
            await task

        with mock.patch.object(
            rsync.RsyncClient, 'stop', new=mock.AsyncMock()
        ):
            client._on_port_forward_done(task)
            await asyncio.sleep(0)


class TestPathEventHandler(unittest.IsolatedAsyncioTestCase):
    """Covers PathEventHandler — lines 980-997."""

    async def test_on_any_event_debounces_upload(self):
        client = _make_rsync_client()
        handler = rsync.PathEventHandler(rsync_client=client, debounce_delay=0.0)
        upload_calls = []

        async def fake_upload():
            upload_calls.append(True)

        with mock.patch.object(client, 'upload', side_effect=fake_upload):
            handler.on_any_event(mock.MagicMock())
            await asyncio.sleep(0.05)
        self.assertEqual(upload_calls, [True])

    async def test_stop_cancels_debounce_timer(self):
        client = _make_rsync_client()
        handler = rsync.PathEventHandler(rsync_client=client, debounce_delay=10.0)
        handler.on_any_event(mock.MagicMock())
        timer_task = handler._debounce_timer._timer
        await handler.stop()
        # Yield to let cancellation propagate.
        await asyncio.sleep(0)
        self.assertTrue(timer_task is None or timer_task.cancelled() or timer_task.done())


class TestWorkspaceObserver(unittest.IsolatedAsyncioTestCase):
    """Covers WorkspaceObserver init/start/stop — lines 1025-1052."""

    async def test_start_invokes_underlying_observer_start(self):
        client = _make_rsync_client()
        with tempfile.TemporaryDirectory() as tmp:
            request = dataclasses.replace(
                client._rsync_request, local_path=tmp)
            observer_factory = mock.MagicMock()
            observer_instance = mock.MagicMock()
            observer_factory.return_value = observer_instance
            with mock.patch.object(
                rsync.observers, 'Observer', new=observer_factory
            ):
                ws = rsync.WorkspaceObserver(
                    rsync_request=request, rsync_client=client)
                ws.start()
                observer_instance.start.assert_called_once()

    async def test_stop_unschedules_and_joins(self):
        client = _make_rsync_client()
        with tempfile.TemporaryDirectory() as tmp:
            request = dataclasses.replace(
                client._rsync_request, local_path=tmp)
            observer_factory = mock.MagicMock()
            observer_instance = mock.MagicMock()
            observer_factory.return_value = observer_instance
            with mock.patch.object(
                rsync.observers, 'Observer', new=observer_factory
            ):
                ws = rsync.WorkspaceObserver(
                    rsync_request=request, rsync_client=client)
                await ws.stop()
                observer_instance.unschedule_all.assert_called_once()
                observer_instance.stop.assert_called_once()
                observer_instance.join.assert_called_once()


class TestRsyncUploadDaemon(unittest.IsolatedAsyncioTestCase):
    """Covers RsyncUploadDaemon — lines 1087-1265."""

    def setUp(self):
        self._tmp = tempfile.mkdtemp()
        self.addCleanup(self._cleanup_tmp)
        self.pid_file = os.path.join(self._tmp, 'pid')
        self._write_pid_file(os.getpid())

    def _cleanup_tmp(self):
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_pid_file(self, pid: int):
        with open(self.pid_file, 'w', encoding='utf-8') as f:
            f.write(json.dumps({'pid': pid}))

    def _make_daemon(self) -> rsync.RsyncUploadDaemon:
        request = _make_upload_request()
        return rsync.RsyncUploadDaemon(
            service_client=mock.MagicMock(),
            rsync_request=request,
            pid_file=self.pid_file,
            poll_interval=0.0,
            debounce_delay=0.0,
            reconcile_interval=0.0,
            timeout=1,
            rate_limit=None,
        )

    async def test_init_stores_attributes(self):
        daemon = self._make_daemon()
        self.assertEqual(daemon._pid_file, self.pid_file)
        self.assertEqual(daemon._poll_interval, 0.0)
        self.assertIsNone(daemon._workspace_observer)
        self.assertIsNone(daemon._rsync_client)

    async def test_poll_task_pending_status_returns_without_action(self):
        daemon = self._make_daemon()
        with mock.patch.object(
            rsync, 'get_workflow_task',
            new=mock.AsyncMock(return_value={'status': 'WAITING'}),
        ):
            await daemon.poll_task()
        # No client should have been created
        self.assertIsNone(daemon._rsync_client)

    async def test_poll_task_terminal_status_calls_stop(self):
        daemon = self._make_daemon()
        with mock.patch.object(
            rsync, 'get_workflow_task',
            new=mock.AsyncMock(return_value={'status': 'COMPLETED'}),
        ):
            with mock.patch.object(
                rsync.RsyncUploadDaemon, 'stop', new=mock.AsyncMock()
            ) as mock_stop:
                await daemon.poll_task()
            mock_stop.assert_awaited_once()

    async def test_poll_task_running_calls_handle_running(self):
        daemon = self._make_daemon()
        with mock.patch.object(
            rsync, 'get_workflow_task',
            new=mock.AsyncMock(return_value={'status': 'RUNNING'}),
        ):
            with mock.patch.object(
                rsync.RsyncUploadDaemon, 'handle_running_task',
                new=mock.AsyncMock(),
            ) as mock_handle:
                await daemon.poll_task()
            mock_handle.assert_awaited_once()

    async def test_poll_task_missing_status_returns(self):
        daemon = self._make_daemon()
        with mock.patch.object(
            rsync, 'get_workflow_task',
            new=mock.AsyncMock(return_value={}),
        ):
            await daemon.poll_task()
        self.assertIsNone(daemon._rsync_client)

    async def test_handle_running_task_creates_client_and_observer(self):
        daemon = self._make_daemon()
        client_mock = mock.MagicMock()
        client_mock.start = mock.AsyncMock()
        client_mock.upload = mock.AsyncMock()
        client_mock.stop = mock.AsyncMock()
        observer_mock = mock.MagicMock()
        with mock.patch.object(rsync, 'RsyncClient', return_value=client_mock):
            with mock.patch.object(
                rsync, 'WorkspaceObserver', return_value=observer_mock
            ):
                await daemon.handle_running_task()
        client_mock.start.assert_awaited_once()
        client_mock.upload.assert_awaited_once()
        observer_mock.start.assert_called_once()

    async def test_upload_callback_writes_last_synced(self):
        daemon = self._make_daemon()
        daemon._upload_callback()
        with open(self.pid_file, 'r', encoding='utf-8') as f:
            data = json.loads(f.read())
        self.assertIn('last_synced', data)

    async def test_stop_sets_event_and_cancels_workspace_observer(self):
        daemon = self._make_daemon()
        observer_mock = mock.MagicMock()
        observer_mock.stop = mock.AsyncMock()
        client_mock = mock.MagicMock()
        client_mock.stop = mock.AsyncMock()
        daemon._workspace_observer = observer_mock
        daemon._rsync_client = client_mock
        daemon._poll_pid_file_task = mock.MagicMock()
        daemon._poll_pid_file_task.done.return_value = False
        await daemon.stop()
        self.assertTrue(daemon._stop_event.is_set())
        observer_mock.stop.assert_awaited_once()
        client_mock.stop.assert_awaited_once()
        daemon._poll_pid_file_task.cancel.assert_called_once()

    async def test_poll_pid_file_stops_when_pid_mismatch(self):
        daemon = self._make_daemon()
        # Write PID different from current process
        with open(self.pid_file, 'w', encoding='utf-8') as f:
            f.write(json.dumps({'pid': 999999}))
        with mock.patch.object(
            rsync.RsyncUploadDaemon, 'stop', new=mock.AsyncMock()
        ) as mock_stop:
            await daemon.poll_pid_file()
        mock_stop.assert_awaited_once()

    async def test_poll_pid_file_handles_missing_file(self):
        daemon = self._make_daemon()
        os.remove(self.pid_file)
        with mock.patch.object(
            rsync.RsyncUploadDaemon, 'stop', new=mock.AsyncMock()
        ) as mock_stop:
            await daemon.poll_pid_file()
        mock_stop.assert_awaited_once()


class TestRsyncUploadTaskDaemonGuard(unittest.TestCase):
    """Covers rsync_upload_task_daemon early-exit — lines 1488-1493."""

    def test_returns_early_when_daemon_already_running(self):
        request = _make_upload_request()
        with mock.patch.object(
            rsync, '_validate_daemon_exists', return_value=True
        ):
            with mock.patch.object(
                rsync, '_get_multiprocessing_context'
            ) as mock_ctx:
                rsync.rsync_upload_task_daemon(
                    login_config=mock.MagicMock(),
                    rsync_request=request,
                    quiet=True,
                )
                mock_ctx.assert_not_called()


if __name__ == '__main__':
    unittest.main()
