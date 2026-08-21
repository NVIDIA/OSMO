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

"""Tests that a final Python image contains only one interpreter runtime."""

import json
import pathlib
import sys
import tarfile
import unittest
from typing import Any


_EXPECTED_BINARY = "opt/osmo-python/bin/python3.14"


def _read_json_blob(layout: pathlib.Path, digest: str) -> dict[str, Any]:
    algorithm, value = digest.split(":", maxsplit=1)
    return json.loads((layout / "blobs" / algorithm / value).read_text())


class PythonImageRuntimeDedupTest(unittest.TestCase):
    """Checks runtime files across the actual OCI layer graph."""

    def test_has_one_python_runtime(self) -> None:
        layout = pathlib.Path(sys.argv[1])
        index = json.loads((layout / "index.json").read_text())
        manifest_descriptor = index["manifests"][0]
        manifest = _read_json_blob(layout, manifest_descriptor["digest"])
        python_binaries: list[str] = []
        libpython_files: list[str] = []

        for layer in manifest["layers"]:
            algorithm, value = layer["digest"].split(":", maxsplit=1)
            with tarfile.open(layout / "blobs" / algorithm / value, mode="r:*") as archive:
                for member in archive.getmembers():
                    name = member.name.removeprefix("./").removeprefix("/")
                    if name.endswith("/bin/python3.14"):
                        python_binaries.append(name)
                    if "/lib/libpython3.14" in name:
                        libpython_files.append(name)

        self.assertEqual(python_binaries, [_EXPECTED_BINARY])
        self.assertEqual(libpython_files, [])


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
