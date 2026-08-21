# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# pylint: disable=line-too-long
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""Tests the runtime-only CPython image layer."""

import hashlib
import pathlib
import sys
import tarfile
import unittest


_BINARY_PATH = "opt/osmo-python/bin/python3.14"
_STDLIB_PREFIX = "opt/osmo-python/lib/python3.14/"
_MAXIMUM_UNPACKED_SIZE = 160_000_000


class PythonRuntimeTarTest(unittest.TestCase):
    """Validates the shared runtime layer's contents and interpreter identity."""

    def setUp(self) -> None:
        self.archive = tarfile.open(sys.argv[1])
        self.members = {
            member.name.removeprefix("./"): member for member in self.archive.getmembers()
        }

    def tearDown(self) -> None:
        self.archive.close()

    def test_contains_runtime_without_development_files(self) -> None:
        self.assertIn(_BINARY_PATH, self.members)
        self.assertIn(_STDLIB_PREFIX + "os.py", self.members)
        self.assertTrue(
            any(name.startswith(_STDLIB_PREFIX + "lib-dynload/") for name in self.members)
        )
        self.assertNotIn("opt/osmo-python/bin/python", self.members)
        self.assertNotIn("opt/osmo-python/bin/python3", self.members)
        self.assertFalse(any("/include/" in name for name in self.members))
        self.assertFalse(
            any(name.startswith("opt/osmo-python/lib/libpython") for name in self.members)
        )
        self.assertLess(
            sum(member.size for member in self.members.values()),
            _MAXIMUM_UNPACKED_SIZE,
        )

    def test_contains_executable_used_by_bazel(self) -> None:
        runtime_binary = self.archive.extractfile(self.members[_BINARY_PATH])
        if runtime_binary is None:
            self.fail(f"{_BINARY_PATH} is not a regular file")

        image_digest = hashlib.sha256(runtime_binary.read()).digest()
        bazel_digest = hashlib.sha256(pathlib.Path(sys.executable).resolve().read_bytes()).digest()

        self.assertNotEqual(self.members[_BINARY_PATH].mode & 0o111, 0)
        self.assertEqual(image_digest, bazel_digest)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
