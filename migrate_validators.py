#!/usr/bin/env python3
"""
Migrate pydantic validators from v1 to v2 syntax.

Transforms:
- @pydantic.validator(...) → @pydantic.field_validator(...)
- @pydantic.root_validator(...) → @pydantic.model_validator(...)

Handles:
- pre=True → mode='before'
- always=True → removed (v2 field_validators always run if field has default)
- check_fields=False → removed (not needed in v2)
- skip_on_failure=True → mode='wrap' (for root validators) or just remove
- Bare @pydantic.root_validator (without parentheses) → @pydantic.model_validator(mode='before')
"""

import re
import os
import sys


def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    if '@pydantic.validator' not in content and '@pydantic.root_validator' not in content:
        return False

    original = content
    lines = content.split('\n')
    result = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Handle @pydantic.root_validator
        if stripped.startswith('@pydantic.root_validator'):
            indent = line[:len(line) - len(line.lstrip())]

            # Collect full decorator (may span multiple lines)
            decorator = stripped
            temp_i = i
            while decorator.count('(') > decorator.count(')') and temp_i + 1 < len(lines):
                temp_i += 1
                decorator += ' ' + lines[temp_i].strip()

            # Parse args
            if '(' in decorator and ')' in decorator:
                args_str = decorator[decorator.index('(') + 1:decorator.rindex(')')]
                is_pre = 'pre=True' in args_str
                skip_on_failure = 'skip_on_failure=True' in args_str
            else:
                # Bare @pydantic.root_validator without parens
                is_pre = False
                skip_on_failure = False

            if is_pre:
                result.append(f"{indent}@pydantic.model_validator(mode='before')")
            else:
                # v1 root_validator without pre runs after field validation
                # In v2, mode='before' receives dict, mode='after' receives model instance
                # Since v1 post-validators receive and return dict, use mode='before'
                result.append(f"{indent}@pydantic.model_validator(mode='before')")

            i = temp_i + 1

            # Check if next line is @classmethod already
            if i < len(lines) and lines[i].strip() == '@classmethod':
                result.append(lines[i])
                i += 1
            else:
                # Add @classmethod
                result.append(f'{indent}@classmethod')

            continue

        # Handle @pydantic.validator(...)
        if stripped.startswith('@pydantic.validator('):
            indent = line[:len(line) - len(line.lstrip())]

            # Collect full decorator
            decorator = stripped
            temp_i = i
            while decorator.count('(') > decorator.count(')') and temp_i + 1 < len(lines):
                temp_i += 1
                decorator += ' ' + lines[temp_i].strip()

            # Parse the decorator arguments
            args_str = decorator[len('@pydantic.validator('):-1]

            # Split into parts respecting quotes
            parts = smart_split(args_str)

            field_names = []
            new_kwargs = []
            has_pre = False

            for part in parts:
                part = part.strip()
                if not part:
                    continue

                if '=' in part and not part.startswith("'") and not part.startswith('"'):
                    key, val = part.split('=', 1)
                    key = key.strip()
                    val = val.strip()

                    if key == 'pre' and val == 'True':
                        has_pre = True
                        new_kwargs.append("mode='before'")
                    elif key == 'always':
                        pass  # Drop always - v2 validators always run when field has default
                    elif key == 'check_fields':
                        pass  # Drop check_fields - not needed in v2
                    else:
                        new_kwargs.append(f'{key}={val}')
                else:
                    field_names.append(part)

            # Build new decorator
            all_args = field_names + new_kwargs
            args = ', '.join(all_args)

            result.append(f'{indent}@pydantic.field_validator({args})')

            i = temp_i + 1

            # Check if next line is @classmethod already
            if i < len(lines) and lines[i].strip() == '@classmethod':
                result.append(lines[i])
                i += 1
            else:
                # Add @classmethod
                result.append(f'{indent}@classmethod')

            continue

        result.append(line)
        i += 1

    content = '\n'.join(result)

    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False


def smart_split(s):
    """Split a string by commas, respecting quotes and parentheses."""
    parts = []
    current = []
    depth = 0
    in_quote = None

    for char in s:
        if char in ('"', "'") and in_quote is None:
            in_quote = char
            current.append(char)
        elif char == in_quote:
            in_quote = None
            current.append(char)
        elif in_quote:
            current.append(char)
        elif char == '(':
            depth += 1
            current.append(char)
        elif char == ')':
            depth -= 1
            current.append(char)
        elif char == ',' and depth == 0:
            parts.append(''.join(current).strip())
            current = []
        else:
            current.append(char)

    if current:
        parts.append(''.join(current).strip())

    return parts


def main():
    src_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
    scope_dirs = ['service', 'lib', 'utils', 'cli', 'operator', 'tests']

    for scope_dir in scope_dirs:
        dir_path = os.path.join(src_dir, scope_dir)
        if not os.path.exists(dir_path):
            continue
        for root, dirs, files in os.walk(dir_path):
            for f in files:
                if f.endswith('.py'):
                    filepath = os.path.join(root, f)
                    if process_file(filepath):
                        rel_path = os.path.relpath(filepath, src_dir)
                        print(f'  Migrated validators: {rel_path}')


if __name__ == '__main__':
    main()
