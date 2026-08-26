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

"""Locks the public OCI configuration of OSMO Python service images."""

import json
import pathlib
import sys
import tarfile
import unittest
from typing import Any


_REQUIRED_ENVIRONMENT = {
    "LANG=C.UTF-8",
    "PYTHONNOUSERSITE=1",
    "PYTHONUNBUFFERED=1",
}
_OMITTED_ENVIRONMENT_PREFIXES = (
    "PIP_BREAK_SYSTEM_PACKAGES=",
    "PYTHONPATH=",
    "PY_VERSION=",
)
_PYTHON_SYMLINKS = {
    "usr/bin/python": "/opt/osmo-python/bin/python3.14",
    "usr/bin/python3": "/opt/osmo-python/bin/python3.14",
    "usr/local/bin/python": "/opt/osmo-python/bin/python3.14",
    "usr/local/bin/python3": "/opt/osmo-python/bin/python3.14",
    "usr/local/bin/python3.14": "/opt/osmo-python/bin/python3.14",
}


def _read_json_blob(layout: pathlib.Path, digest: str) -> dict[str, Any]:
    algorithm, value = digest.split(":", maxsplit=1)
    return json.loads((layout / "blobs" / algorithm / value).read_text())


def _read_progress_check_contract(
    layout: pathlib.Path,
) -> tuple[set[str], bytes | None]:
    index = json.loads((layout / "index.json").read_text())
    manifest = _read_json_blob(layout, index["manifests"][0]["digest"])
    member_names: set[str] = set()
    progress_check_wrapper: bytes | None = None

    for layer in manifest["layers"]:
        algorithm, value = layer["digest"].split(":", maxsplit=1)
        with tarfile.open(layout / "blobs" / algorithm / value, mode="r:*") as archive:
            for member in archive.getmembers():
                name = member.name.removeprefix("./").removeprefix("/")
                member_names.add(name)
                if name == "usr/bin/progress_check" and member.isfile():
                    extracted = archive.extractfile(member)
                    if extracted is None:
                        raise ValueError("Could not read progress_check wrapper")
                    progress_check_wrapper = extracted.read()

    return member_names, progress_check_wrapper


class OCIImageContractTest(unittest.TestCase):
    """Checks the command and process environment exposed to callers."""

    def test_preserves_service_image_contract(self) -> None:
        layout = pathlib.Path(sys.argv[1])
        index = json.loads((layout / "index.json").read_text())
        manifest = _read_json_blob(layout, index["manifests"][0]["digest"])
        image = _read_json_blob(layout, manifest["config"]["digest"])
        config = image["config"]

        self.assertEqual(config["Entrypoint"], ["/usr/bin/shelless_ulimit"])
        self.assertIsNone(config.get("Cmd"))
        self.assertEqual(config["User"], "osmo")
        self.assertEqual(config["WorkingDir"], "/app")
        self.assertLessEqual(_REQUIRED_ENVIRONMENT, set(config["Env"]))
        self.assertFalse(any(value.startswith("PYTHONHOME=") for value in config["Env"]))

    def test_omits_build_time_and_legacy_python_environment(self) -> None:
        layout = pathlib.Path(sys.argv[1])
        index = json.loads((layout / "index.json").read_text())
        manifest = _read_json_blob(layout, index["manifests"][0]["digest"])
        image = _read_json_blob(layout, manifest["config"]["digest"])

        self.assertFalse(
            any(
                value.startswith(_OMITTED_ENVIRONMENT_PREFIXES)
                for value in image["config"]["Env"]
            )
        )

    def test_preserves_python_executable_paths(self) -> None:
        layout = pathlib.Path(sys.argv[1])
        index = json.loads((layout / "index.json").read_text())
        manifest = _read_json_blob(layout, index["manifests"][0]["digest"])
        final_members: dict[str, tarfile.TarInfo] = {}

        for layer in manifest["layers"]:
            algorithm, value = layer["digest"].split(":", maxsplit=1)
            with tarfile.open(layout / "blobs" / algorithm / value, mode="r:*") as archive:
                for member in archive.getmembers():
                    name = member.name.removeprefix("./").removeprefix("/")
                    if name in _PYTHON_SYMLINKS:
                        final_members[name] = member

        for path, target in _PYTHON_SYMLINKS.items():
            self.assertIn(path, final_members)
            self.assertTrue(final_members[path].issym())
            self.assertEqual(final_members[path].linkname, target)

    def test_progress_check_uses_service_runfiles(self) -> None:
        member_names, progress_check_wrapper = _read_progress_check_contract(
            pathlib.Path(sys.argv[1])
        )

        if progress_check_wrapper is None:
            self.fail("Image does not contain /usr/bin/progress_check")
        self.assertIn(
            b"/src/service/router/router_binary.runfiles",
            progress_check_wrapper,
        )
        self.assertIn(
            "src/service/router/router_binary.runfiles/_main/"
            "src/utils/progress_check/progress_check.py",
            member_names,
        )
        self.assertFalse(
            any("progress_check_binary.runfiles" in name for name in member_names)
        )


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
