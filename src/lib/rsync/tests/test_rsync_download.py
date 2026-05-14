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
# pylint: disable=protected-access

import os
import tempfile
import unittest
from typing import List
from unittest import mock

from src.lib.rsync import rsync


def _make_request(remote_path: str) -> rsync.RsyncRequest:
    return rsync.RsyncRequest(
        workflow_id='wf-1',
        task_name='task-main',
        direction=rsync.RsyncDirection.DOWNLOAD,
        local_path='/tmp/dst',
        remote_module='osmo',
        remote_path='ignored',
        original_remote_path=remote_path,
    )


def _make_client(remote_path: str) -> rsync.RsyncClient:
    client = rsync.RsyncClient.__new__(rsync.RsyncClient)
    client._rsync_request = _make_request(remote_path)
    return client


class TestDownloadLanded(unittest.TestCase):
    """Tests for RsyncClient._download_landed missing-source detection."""

    def test_file_landed_when_basename_exists(self):
        with tempfile.TemporaryDirectory() as dst:
            with open(os.path.join(dst, 'foo.txt'), 'w', encoding='utf-8') as f:
                f.write('hello')

            client = _make_client('/osmo/run/workspace/foo.txt')
            self.assertTrue(client._download_landed(dst, None))

    def test_file_missing_when_basename_not_present(self):
        with tempfile.TemporaryDirectory() as dst:
            client = _make_client('/osmo/run/workspace/no_such_file.txt')
            self.assertFalse(client._download_landed(dst, None))

    def test_redownload_with_preexisting_file_succeeds(self):
        # In-sync re-download: no new entries, but basename still exists.
        with tempfile.TemporaryDirectory() as dst:
            with open(os.path.join(dst, 'foo.txt'), 'w', encoding='utf-8') as f:
                f.write('previous run')

            client = _make_client('/osmo/run/workspace/foo.txt')
            self.assertTrue(client._download_landed(dst, None))

    def test_trailing_slash_directory_with_new_entries_succeeds(self):
        with tempfile.TemporaryDirectory() as dst:
            with open(os.path.join(dst, 'a.txt'), 'w', encoding='utf-8') as f:
                f.write('a')

            client = _make_client('/osmo/run/workspace/')
            self.assertTrue(client._download_landed(dst, set()))

    def test_trailing_slash_directory_with_no_new_entries_flagged(self):
        with tempfile.TemporaryDirectory() as dst:
            client = _make_client('/osmo/run/workspace/')
            self.assertFalse(client._download_landed(dst, set()))

    def test_named_directory_landed_when_subdir_exists(self):
        with tempfile.TemporaryDirectory() as dst:
            os.makedirs(os.path.join(dst, 'some_dir'))
            client = _make_client('/osmo/run/workspace/some_dir')
            self.assertTrue(client._download_landed(dst, None))

    def test_named_directory_missing_when_subdir_absent(self):
        with tempfile.TemporaryDirectory() as dst:
            client = _make_client('/osmo/run/workspace/no_such_dir')
            self.assertFalse(client._download_landed(dst, None))


class TestStreamProgressTail(unittest.IsolatedAsyncioTestCase):
    """The Synced-N-files tail line is gone; we just clean the cursor row."""

    async def test_no_synced_files_summary(self):
        # Verbose chatter for a missing source: two non-space lines, no progress.
        stdout = mock.MagicMock()
        lines = iter([
            b'receiving incremental file list\n',
            b'sent 8 bytes  received 9 bytes  3.40 bytes/sec\n',
            b'',  # EOF
        ])

        async def readline():
            return next(lines)

        stdout.readline = readline

        captured: List[str] = []
        with mock.patch.object(rsync.sys.stdout, 'write',
                               side_effect=captured.append):
            with mock.patch.object(rsync.sys.stdout, 'flush'):
                await rsync._stream_progress(stdout)

        joined = ''.join(captured)
        self.assertNotIn('Synced', joined)
        self.assertNotIn('files', joined)


if __name__ == '__main__':
    unittest.main()
