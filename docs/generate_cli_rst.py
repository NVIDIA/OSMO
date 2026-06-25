# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

"""Freeze the CLI reference pages into static reStructuredText.

The CLI reference pages normally use the ``argparse-with-postprocess`` directive,
which imports ``src.cli.main_parser`` and introspects the live parser at build
time. For ``sphinx-multiversion`` builds that is a problem on older release
branches whose code is not importable under the current dependencies. This
script renders each page's CLI section to static rST (mimicking the directive's
output, including the ``cli_reference_*`` cross-reference anchors) and rewrites
the page in place, so the documentation build no longer needs to import any code
for those pages.

Run this in the environment of the branch you are freezing (so the parser
reflects that branch's CLI), then commit the modified ``*.rst`` files:

    make -C docs cli-rst

The rewrite is idempotent: a provenance comment records the original directive
options so the page can be regenerated. It detects either a live
``argparse-with-postprocess`` directive or a previously generated block.

Note: subcommand-level and subsection-level anchors (the ones referenced from
other pages, e.g. ``cli_reference_workflow_submit``) are reproduced. Per-argument
deep-link anchors produced by ``:argument-anchor:`` are intentionally omitted on
the static pages, as nothing cross-references them.
"""

import importlib
import re
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent
REPO_ROOT = DOCS_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from sphinxarg.parser import parse_parser, parser_navigate  # noqa: E402

DIRECTIVE_PREFIX = '.. argparse-with-postprocess::'
SENTINEL = '.. CLI-REFERENCE-GENERATED'
SOURCE_PREFIX = '.. cli-source:'

# Heading underline characters for levels below the page title (which uses '=').
HEADING_CHARS = ['-', '~', '^', '"', '+']

# RST section header inside an epilog, e.g. "Examples\n--------".
_RST_SECTION_PATTERN = re.compile(r'^([^\n]+)\n([=\-~`\'"^_*+#]+)$', re.MULTILINE)


def convert_epilog_sections_to_rubric(epilog: str) -> str:
    """Convert RST section headers in an epilog to ``.. rubric::`` directives.

    Mirrors the directive's epilog handling so section titles inside epilogs do
    not break the page's heading hierarchy.
    """
    if not epilog:
        return epilog

    def replace_section(match: re.Match) -> str:
        title = match.group(1).strip()
        underline = match.group(2)
        if len(underline) >= len(title):
            return f'.. rubric:: {title}'
        return match.group(0)

    return _RST_SECTION_PATTERN.sub(replace_section, epilog)


def slugify(text: str) -> str:
    """Match the slug scheme used by the argparse postprocess extension."""
    text = re.sub(r'^-+', '', text)
    text = re.sub(r'[^a-zA-Z0-9]+', '_', text)
    return text.strip('_').lower()


def _is_suppressed(value) -> bool:
    if value is None:
        return True
    return str(value).replace('"', '').replace("'", '') == '==SUPPRESS=='


def _heading(text: str, level: int) -> list[str]:
    char = HEADING_CHARS[min(level, len(HEADING_CHARS) - 1)]
    return [text, char * max(len(text), 3), '']


def _anchor(label: str) -> list[str]:
    return [f'.. _{label}:', '']


def _usage_block(usage: str) -> list[str]:
    out = ['.. code-block:: text', '']
    for line in (usage.splitlines() or ['']):
        out.append(f'   {line}' if line else '')
    out.append('')
    return out


def _indent(text: str, spaces: int = 4) -> list[str]:
    pad = ' ' * spaces
    return [(pad + line if line else '') for line in text.splitlines()]


def _render_option(option: dict) -> list[str]:
    """Render one argument as a definition-list entry."""
    term = ', '.join(option['name'])
    parts: list[str] = []
    if 'choices' in option:
        parts.append('Possible choices: ' + ', '.join(str(c) for c in option['choices']))
    if option.get('help'):
        parts.append(option['help'])
    if not _is_suppressed(option.get('default')):
        default_str = str(option['default']).replace('`', r'\`')
        parts.append(f'Default: ``{default_str}``')
    if not parts:
        parts.append('Undocumented')

    lines = [f'``{term}``']
    for index, part in enumerate(parts):
        if index:
            lines.append('')
        lines.extend(_indent(part))
    lines.append('')
    return lines


def _render_action_groups(data: dict, level: int, anchor_prefix: str) -> list[str]:
    lines: list[str] = []
    for group in data.get('action_groups', []):
        options = group.get('options', [])
        if not options:
            continue
        title = group['title']
        lines.extend(_anchor(f'{anchor_prefix}_{slugify(title)}'))
        lines.extend(_heading(title, level))
        if group.get('description'):
            lines.extend([group['description'], ''])
        for option in options:
            lines.extend(_render_option(option))
    return lines


def _render_epilog(epilog: str) -> list[str]:
    return ['', convert_epilog_sections_to_rubric(epilog), '']


def _render_subcommand(child: dict, ref_prefix: str, level: int) -> list[str]:
    name = child['name']
    ref = f'{ref_prefix}_{slugify(name)}'
    lines: list[str] = []
    lines.extend(_anchor(ref))
    lines.extend(_heading(name, level))

    description = child.get('description') or child.get('help') or 'Undocumented'
    lines.extend([description, ''])
    if child.get('bare_usage'):
        lines.extend(_usage_block(child['bare_usage']))

    lines.extend(_render_action_groups(child, level + 1, ref))

    for grandchild in child.get('children', []):
        lines.extend(_render_subcommand(grandchild, ref, level + 1))

    if child.get('epilog'):
        lines.extend(_render_epilog(child['epilog']))
    return lines


def render_page(result: dict, ref_prefix: str) -> str:
    """Render the static rST body for one CLI page's ``:path:`` target."""
    lines: list[str] = []

    if result.get('description'):
        lines.extend([result['description'], ''])
    if result.get('usage'):
        lines.extend(_usage_block(result['usage']))

    # The command's own options (present on leaf commands).
    lines.extend(_render_action_groups(result, level=0, anchor_prefix=ref_prefix))

    children = result.get('children', [])
    if children:
        lines.extend(_heading('Sub-commands', 0))
        for child in children:
            lines.extend(_render_subcommand(child, ref_prefix, level=1))

    if result.get('epilog'):
        lines.extend(_render_epilog(result['epilog']))

    # Collapse trailing blank lines to a single newline at EOF.
    while lines and lines[-1] == '':
        lines.pop()
    return '\n'.join(lines) + '\n'


def _parse_directive_options(block_lines: list[str]) -> dict:
    options: dict = {}
    for line in block_lines:
        stripped = line.strip()
        match = re.match(r':([a-zA-Z0-9_-]+):\s*(.*)$', stripped)
        if match:
            options[match.group(1)] = match.group(2).strip()
    return options


def _parse_source_comment(line: str) -> dict:
    payload = line.split(SOURCE_PREFIX, 1)[1].strip()
    options: dict = {}
    for field in payload.split('|'):
        field = field.strip()
        if not field:
            continue
        if field.startswith('flags='):
            for flag in field[len('flags='):].split(','):
                flag = flag.strip()
                if flag:
                    options[flag] = ''
        elif '=' in field:
            key, value = field.split('=', 1)
            options[key.strip()] = value.strip()
    return options


def _find_region_start(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(DIRECTIVE_PREFIX) or stripped.startswith(SENTINEL):
            return index
    return None


def _extract_options(lines: list[str], start: int) -> dict:
    region = lines[start:]
    # Live directive block.
    if region[0].strip().startswith(DIRECTIVE_PREFIX):
        return _parse_directive_options(region[1:])
    # Previously generated: read the provenance comment.
    for line in region:
        if line.strip().startswith(SOURCE_PREFIX):
            return _parse_source_comment(line.strip())
    return {}


def _provenance(options: dict) -> list[str]:
    flags = [k for k in ('argument-anchor', 'markdown', 'nosubcommands', 'nodescription')
             if k in options]
    fields = [
        f"module={options.get('module', 'src.cli.main_parser')}",
        f"func={options.get('func', 'create_cli_parser')}",
        f"prog={options.get('prog', 'osmo')}",
        f"path={options.get('path', '')}",
        f"ref-prefix={options.get('ref-prefix', '')}",
        f"flags={','.join(flags)}",
    ]
    return [
        f'{SENTINEL} -- do not edit by hand; regenerate with: make -C docs cli-rst',
        f'{SOURCE_PREFIX} ' + ' | '.join(fields),
        '',
    ]


def process_page(path: Path, parser_cache: dict) -> bool:
    """Rewrite one CLI page in place. Returns True if the page was changed."""
    original = path.read_text(encoding='utf-8')
    lines = original.splitlines()

    start = _find_region_start(lines)
    if start is None:
        return False

    options = _extract_options(lines, start)
    cli_path = options.get('path', '')
    ref_prefix = options.get('ref-prefix', '')
    if not ref_prefix:
        raise ValueError(f'{path}: could not determine :ref-prefix:')

    module_name = options.get('module', 'src.cli.main_parser')
    func_name = options.get('func', 'create_cli_parser')
    prog = options.get('prog', 'osmo')

    cache_key = (module_name, func_name, prog)
    if cache_key not in parser_cache:
        module = importlib.import_module(module_name)
        parser = getattr(module, func_name)()
        parser.prog = prog
        parser_cache[cache_key] = parse_parser(parser)
    data = parser_cache[cache_key]

    result = parser_navigate(data, cli_path)
    body = render_page(result, ref_prefix)

    preamble = lines[:start]
    while preamble and preamble[-1].strip() == '':
        preamble.pop()

    new_lines = preamble + [''] + _provenance(options) + body.splitlines()
    new_text = '\n'.join(new_lines).rstrip('\n') + '\n'

    if new_text != original:
        path.write_text(new_text, encoding='utf-8')
        return True
    return False


def discover_pages() -> list[Path]:
    pages: list[Path] = []
    for rst in DOCS_DIR.rglob('*.rst'):
        text = rst.read_text(encoding='utf-8')
        if DIRECTIVE_PREFIX in text or SENTINEL in text:
            pages.append(rst)
    return sorted(pages)


def main() -> None:
    parser_cache: dict = {}
    changed = 0
    pages = discover_pages()
    for page in pages:
        if process_page(page, parser_cache):
            changed += 1
            print(f'updated {page.relative_to(REPO_ROOT)}')
    print(f'Processed {len(pages)} page(s); {changed} updated.')


if __name__ == '__main__':
    main()
