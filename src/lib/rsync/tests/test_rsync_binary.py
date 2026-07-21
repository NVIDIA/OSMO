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

import os
import subprocess
import tempfile
import unittest

from python import runfiles  # type: ignore


RSYNC_BINARY_RUNFILE = 'osmo_workspace/src/lib/rsync/rsync_bin'


class TestRsyncBinary(unittest.TestCase):
    """Exercises failure behavior of the gokr-rsync binary bundled with the CLI."""

    def setUp(self):
        runfiles_environment = runfiles.Create()
        if runfiles_environment is None:
            self.fail('Bazel runfiles environment is unavailable')
        runfiles_path = runfiles_environment.Rlocation(RSYNC_BINARY_RUNFILE)
        if not runfiles_path:
            self.fail(f'Runfile not found: {RSYNC_BINARY_RUNFILE}')
        self.rsync_binary = runfiles_path

    def test_missing_source_returns_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            destination = os.path.join(tmp, 'destination')
            os.mkdir(destination)

            result = subprocess.run(
                [
                    self.rsync_binary,
                    '-av',
                    '--gokr.dont_restrict',
                    os.path.join(tmp, 'missing', 'source'),
                    destination,
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_default_mode_landlock_failure_returns_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = os.path.join(tmp, 'payload')
            destination = os.path.join(tmp, 'destination')
            os.mkdir(source)
            with open(os.path.join(source, 'run.sh'), 'w', encoding='utf-8') as source_file:
                source_file.write('payload')
            os.mkdir(destination)

            result = subprocess.run(
                [
                    self.rsync_binary,
                    '-av',
                    source,
                    destination,
                ],
                check=False,
                capture_output=True,
                text=True,
            )

            expected_file = os.path.join(destination, 'payload', 'run.sh')
            if os.path.isfile(expected_file):
                self.skipTest('Landlock restriction is unavailable or no longer applies')
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

if __name__ == '__main__':
    unittest.main()
