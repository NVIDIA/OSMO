"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "update_distroless.py"
SPEC = importlib.util.spec_from_file_location("update_distroless", MODULE_PATH)
assert SPEC is not None
update_distroless = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = update_distroless
SPEC.loader.exec_module(update_distroless)


class UpdateDistrolessTest(unittest.TestCase):
    def test_latest_version_for_prefix_ignores_attestations_and_dev_tags(self):
        tags = [
            "3.14-v4.0.8-dev",
            "3.14-v4.0.7",
            "3.14-v4.0.10",
            "3.13-v4.0.99",
            "sha256-deadbeef.sig",
        ]

        self.assertEqual(
            update_distroless.latest_version_for_prefix(tags, "3.14"),
            "4.0.10",
        )
        self.assertEqual(
            update_distroless.latest_version_for_prefix(
                tags,
                "3.14",
                dev=True,
            ),
            "4.0.8",
        )

    def test_update_text_rewrites_only_distroless_pins(self):
        latest = update_distroless.DistrolessLatest(
            python_version="4.0.9",
            python_digest="sha256:" + "a" * 64,
            python_dev_digest="sha256:" + "b" * 64,
            node_version="4.0.9",
        )
        module_text = '''oci.pull(
    name = "distroless_python3_14",
    digest = "sha256:49751a52c1b4f59e0b68d6caf6728f305afc9e47c507008f8a9e8e1253929676",
    image = BASE_DISTROLESS_IMAGE_URL + "python:3.14-v4.0.8",
)

# oci.pull(
#     name = "distroless_python3_14_dev",
#     digest = "sha256:84aef61c2e737ac04e38e0945d423af8e9121774f223f1650b71be8a6968abba",
#     image = BASE_DISTROLESS_IMAGE_URL + "python:3.14-v4.0.8-dev",
# )
'''
        dockerfile_text = (
            "ARG NODE_BUILD_IMAGE=node:24-slim\n"
            "ARG NODE_DISTROLESS_IMAGE=nvcr.io/nvidia/distroless/node:24-v4.0.8\n"
        )

        new_module = update_distroless.update_module_text(module_text, latest)
        new_dockerfile = update_distroless.update_dockerfile_text(
            dockerfile_text,
            latest,
        )

        self.assertIn('python:3.14-v4.0.9"', new_module)
        self.assertIn('python:3.14-v4.0.9-dev"', new_module)
        self.assertIn("sha256:" + "a" * 64, new_module)
        self.assertIn("sha256:" + "b" * 64, new_module)
        self.assertIn("node:24-v4.0.9", new_dockerfile)

    def test_python_image_version_is_single_target_knob(self):
        latest = update_distroless.DistrolessLatest(
            python_version="4.0.9",
            python_digest="sha256:" + "a" * 64,
            python_dev_digest="sha256:" + "b" * 64,
            node_version="4.0.9",
        )
        module_text = '''oci.pull(
    name = "distroless_python3_14",
    digest = "sha256:49751a52c1b4f59e0b68d6caf6728f305afc9e47c507008f8a9e8e1253929676",
    image = BASE_DISTROLESS_IMAGE_URL + "python:3.14-v4.0.8",
)

# oci.pull(
#     name = "distroless_python3_14_dev",
#     digest = "sha256:84aef61c2e737ac04e38e0945d423af8e9121774f223f1650b71be8a6968abba",
#     image = BASE_DISTROLESS_IMAGE_URL + "python:3.14-v4.0.8-dev",
# )
'''
        original_python_version = update_distroless.PYTHON_IMAGE_VERSION
        try:
            update_distroless.PYTHON_IMAGE_VERSION = "3.15"
            new_module = update_distroless.update_module_text(module_text, latest)
        finally:
            update_distroless.PYTHON_IMAGE_VERSION = original_python_version

        self.assertIn('python:3.15-v4.0.9"', new_module)
        self.assertIn('python:3.15-v4.0.9-dev"', new_module)

    def test_branch_name_uses_shared_distroless_version_when_possible(self):
        latest = update_distroless.DistrolessLatest(
            python_version="4.0.9",
            python_digest="sha256:" + "a" * 64,
            python_dev_digest="sha256:" + "b" * 64,
            node_version="4.0.9",
        )

        self.assertEqual(
            update_distroless.branch_name_for(latest),
            "automation/update-distroless-v4-0-9",
        )


if __name__ == "__main__":
    unittest.main()
