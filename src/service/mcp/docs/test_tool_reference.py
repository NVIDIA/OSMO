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

import contextlib
import dataclasses
import io
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from src.service.mcp import tool_registry
from src.service.mcp.docs import generate_tool_reference


_REFERENCE = Path(__file__).with_name('TOOL_REFERENCE.md')


class ToolReferenceTest(unittest.TestCase):
    """Freshness supplements, rather than replaces, independent catalog contracts."""

    def test_checked_in_reference_is_current(self) -> None:
        self.assertEqual(
            _REFERENCE.read_text(encoding='utf-8'),
            generate_tool_reference.render_reference(),
            'Regenerate the reference using the command in TOOLS.md.',
        )

    def test_registry_metadata_changes_make_reference_stale(self) -> None:
        first, *remaining = tool_registry.TOOL_SPECS
        changed_specs = (
            dataclasses.replace(first, title='Changed title'),
            dataclasses.replace(first, description='Changed description'),
            dataclasses.replace(first, annotations=first.annotations.model_copy(
                update={'openWorldHint': not first.annotations.openWorldHint},
            )),
        )
        for changed in changed_specs:
            with self.subTest(spec=changed), mock.patch.object(
                    tool_registry, 'TOOL_SPECS', (changed, *remaining)), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(generate_tool_reference.main([
                    '--output', str(_REFERENCE), '--check',
                ]), 1)

    def test_generation_is_deterministic_and_check_rejects_stale_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'reference.md'
            arguments = ['--output', str(output)]
            self.assertEqual(generate_tool_reference.main(arguments), 0)
            first = output.read_bytes()
            self.assertEqual(generate_tool_reference.main(arguments), 0)
            self.assertEqual(output.read_bytes(), first)
            self.assertEqual(generate_tool_reference.main([*arguments, '--check']), 0)
            output.write_text('Stale reference\n', encoding='utf-8')
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                self.assertEqual(generate_tool_reference.main([*arguments, '--check']), 1)
            self.assertIn('out of date', errors.getvalue())
            self.assertEqual(output.read_text(encoding='utf-8'), 'Stale reference\n')

    def test_check_does_not_create_missing_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'missing.md'
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(generate_tool_reference.main([
                    '--output', str(output), '--check',
                ]), 1)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
