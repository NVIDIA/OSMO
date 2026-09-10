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

"""Checks that a Python image packages one application runfiles tree."""

import json
import pathlib
import re
import sys
import tarfile
import unittest
from typing import Any


def _read_json_blob(layout: pathlib.Path, digest: str) -> dict[str, Any]:
    algorithm, value = digest.split(":", maxsplit=1)
    return json.loads((layout / "blobs" / algorithm / value).read_text())


def _read_image(
    layout: pathlib.Path, wrapper_path: str | None
) -> tuple[set[str], list[str], bytes | None]:
    index = json.loads((layout / "index.json").read_text())
    manifest = _read_json_blob(layout, index["manifests"][0]["digest"])
    member_names: set[str] = set()
    raw_member_names: list[str] = []
    wrapper: bytes | None = None

    for layer in manifest["layers"]:
        algorithm, value = layer["digest"].split(":", maxsplit=1)
        with tarfile.open(layout / "blobs" / algorithm / value, mode="r:*") as archive:
            for member in archive.getmembers():
                raw_member_names.append(member.name)
                name = member.name.removeprefix("./").removeprefix("/")
                member_names.add(name)
                if name == wrapper_path and member.isfile():
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise ValueError(f"Could not read {member.name}")
                    wrapper = extracted.read()

    return member_names, raw_member_names, wrapper


class PythonImageRunfilesDedupTest(unittest.TestCase):
    """Locks the single-runfiles-tree image contract."""

    expected_runfiles: str
    wrapper_path: str | None
    main_path: str | None
    member_names: set[str]
    raw_member_names: list[str]
    wrapper: bytes | None

    @classmethod
    def setUpClass(cls) -> None:
        cls.expected_runfiles = sys.argv[2].strip("/")
        cls.wrapper_path = sys.argv[3].strip("/") if len(sys.argv) > 3 else None
        cls.main_path = sys.argv[4].strip("/") if len(sys.argv) > 4 else None
        cls.member_names, cls.raw_member_names, cls.wrapper = _read_image(
            pathlib.Path(sys.argv[1]), cls.wrapper_path
        )

    def test_layer_members_stay_within_image_root(self) -> None:
        unsafe_member_names = []
        for raw_member_name in self.raw_member_names:
            member_path = pathlib.PurePosixPath(raw_member_name.removeprefix("./"))
            if member_path.is_absolute() or ".." in member_path.parts:
                unsafe_member_names.append(raw_member_name)

        self.assertEqual(unsafe_member_names, [])

    def test_uses_single_application_runfiles_tree(self) -> None:
        runfiles_pattern = re.compile(r"^(.+?\.runfiles)(?:/|$)")
        runfiles = {
            match.group(1)
            for name in self.member_names
            if (match := runfiles_pattern.match(name)) is not None
        }

        matching_runfiles = {
            runfiles_path
            for runfiles_path in runfiles
            if runfiles_path == self.expected_runfiles
            or runfiles_path.endswith(f"/{self.expected_runfiles}")
        }
        self.assertEqual(len(matching_runfiles), 1)
        self.assertEqual(runfiles, matching_runfiles)

    def test_companion_entry_point_uses_application_runfiles(self) -> None:
        if self.wrapper_path is None or self.main_path is None:
            self.skipTest("Image has no companion entry point")

        if self.wrapper is None:
            self.fail(f"Image does not contain {self.wrapper_path}")
        self.assertIn(
            f"/{self.expected_runfiles}".encode(),
            self.wrapper,
        )
        actual_runfiles = next(
            runfiles_path
            for runfiles_path in self.member_names
            if runfiles_path == self.expected_runfiles
            or runfiles_path.endswith(f"/{self.expected_runfiles}")
        )
        self.assertTrue(
            any(
                name.startswith(f"{actual_runfiles}/")
                and name.endswith(f"/{self.main_path}")
                for name in self.member_names
            )
        )


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
