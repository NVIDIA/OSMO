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
from pathlib import Path
import sys

from src.service.mcp import tool_registry


_HEADER = '''<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# MCP tool reference

Generated from [tool_registry.py](../tool_registry.py); do not edit by hand.
See [tool contracts](../TOOLS.md) for API mappings, CLI relationships, and
operational caveats. Annotations are client-facing hints, not authorization rules.

'''


def render_reference() -> str:
    """Render registration metadata in the registry's canonical order."""
    sections = [_HEADER]
    for spec in tool_registry.TOOL_SPECS:
        annotations = json.dumps(
            spec.annotations.model_dump(exclude_none=True), sort_keys=True,
        )
        sections.append(
            f'## `{spec.name}`\n\n{spec.title}\n\n{spec.description}\n\n'
            f'Annotations: `{annotations}`\n\n'
        )
    return ''.join(sections).rstrip() + '\n'


def main(argv: list[str] | None = None) -> int:
    """Generate an explicit output path, or check it without writing."""
    parser = argparse.ArgumentParser(description='Generate the MCP tool reference.')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Fail if the output is stale.')
    args = parser.parse_args(argv)
    rendered = render_reference()
    if args.check:
        if args.output.is_file() and args.output.read_text(encoding='utf-8') == rendered:
            return 0
        print('MCP tool reference is missing or out of date; regenerate it.', file=sys.stderr)
        return 1
    args.output.write_text(rendered, encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main())
