#!/usr/bin/env python3
"""
Migrate pydantic.Field() calls with custom extra kwargs (command_line, env, action, type)
to use json_schema_extra={} in pydantic v2.

Only processes files that have pydantic.Field() with known extra kwargs.
"""
import re
import os
import sys


# Extra kwargs that are NOT standard pydantic.Field() parameters
EXTRA_KWARGS = {'command_line', 'env', 'action', 'type'}

# Standard pydantic.Field() kwargs that should stay as-is
STANDARD_KWARGS = {
    'default', 'default_factory', 'alias', 'title', 'description',
    'gt', 'ge', 'lt', 'le', 'multiple_of', 'strict', 'min_length', 'max_length',
    'pattern', 'discriminator', 'json_schema_extra', 'frozen', 'validate_default',
    'repr', 'init', 'init_var', 'kw_only', 'exclude', 'include', 'deprecated',
    'examples', 'max_digits', 'decimal_places',
}


def find_field_call_end(text, start):
    """Find the end of a pydantic.Field(...) call starting after the opening paren."""
    depth = 1
    pos = start
    in_str = None
    escape = False
    while pos < len(text) and depth > 0:
        ch = text[pos]
        if escape:
            escape = False
        elif ch == '\\':
            escape = True
        elif in_str:
            if ch == in_str:
                in_str = None
        elif ch in ("'", '"'):
            in_str = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if depth > 0:
            pos += 1
    return pos  # position of closing )


def split_args(text):
    """Split comma-separated args respecting nested parens, brackets, strings."""
    args = []
    current = []
    depth = 0
    in_str = None
    escape = False
    for ch in text:
        if escape:
            current.append(ch)
            escape = False
            continue
        if ch == '\\' and in_str:
            current.append(ch)
            escape = True
            continue
        if in_str:
            current.append(ch)
            if ch == in_str:
                in_str = None
            continue
        if ch in ("'", '"'):
            in_str = ch
            current.append(ch)
            continue
        if ch in ('(', '[', '{'):
            depth += 1
            current.append(ch)
        elif ch in (')', ']', '}'):
            depth -= 1
            current.append(ch)
        elif ch == ',' and depth == 0:
            args.append(''.join(current))
            current = []
        else:
            current.append(ch)
    if current:
        s = ''.join(current).strip()
        if s:
            args.append(''.join(current))
    return args


def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    if 'pydantic.Field(' not in content:
        return False
    
    # Check if any extra kwargs exist
    has_extras = False
    for kw in EXTRA_KWARGS:
        # Check for kwarg= pattern inside a pydantic.Field context
        if re.search(rf'\b{kw}\s*=', content):
            has_extras = True
            break
    
    if not has_extras:
        return False
    
    original = content
    
    # Find all pydantic.Field( occurrences and process them right-to-left to preserve positions
    pattern = re.compile(r'pydantic\.Field\(')
    matches = list(pattern.finditer(content))
    
    for match in reversed(matches):
        field_start = match.start()
        args_start = match.end()  # position right after '('
        args_end = find_field_call_end(content, args_start)  # position of closing ')'
        
        args_text = content[args_start:args_end]
        
        # Check if this Field has any extra kwargs
        has_field_extras = False
        for kw in EXTRA_KWARGS:
            if re.search(rf'(?<!\w){kw}\s*=', args_text):
                has_field_extras = True
                break
        
        if not has_field_extras:
            continue
        
        # Parse the args
        raw_args = split_args(args_text)
        
        standard_parts = []
        extra_parts = {}
        
        for arg in raw_args:
            stripped = arg.strip()
            kw_match = re.match(r'^(\w+)\s*=\s*', stripped)
            if kw_match:
                key = kw_match.group(1)
                value = stripped[kw_match.end():].strip()
                if key in EXTRA_KWARGS:
                    extra_parts[key] = value
                else:
                    standard_parts.append(arg)
            else:
                standard_parts.append(arg)
        
        if not extra_parts:
            continue
        
        # Build json_schema_extra dict string
        extra_items = []
        for key, value in extra_parts.items():
            extra_items.append(f"'{key}': {value}")
        extra_dict = '{' + ', '.join(extra_items) + '}'
        
        # Determine formatting - check if multiline
        is_multiline = '\n' in args_text
        
        if is_multiline:
            # Find the indentation of arguments
            indent_match = re.search(r'\n(\s+)', args_text)
            if indent_match:
                arg_indent = indent_match.group(1)
            else:
                # Get indent from the line containing pydantic.Field
                line_start = content.rfind('\n', 0, field_start) + 1
                base_indent = ' ' * (field_start - line_start)
                arg_indent = base_indent + '    '
            
            # Rebuild with proper formatting
            new_args_parts = []
            for part in standard_parts:
                new_args_parts.append(part.strip())
            new_args_parts.append(f'json_schema_extra={extra_dict}')
            
            new_args = (',\n' + arg_indent).join(new_args_parts)
            new_field_content = f'\n{arg_indent}{new_args}'
        else:
            new_args_parts = []
            for part in standard_parts:
                new_args_parts.append(part.strip())
            new_args_parts.append(f'json_schema_extra={extra_dict}')
            new_field_content = ', '.join(new_args_parts)
        
        content = content[:args_start] + new_field_content + content[args_end:]
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False


def main():
    src_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
    scope_dirs = ['service', 'lib', 'utils', 'cli', 'operator', 'tests']
    
    changed = []
    for scope_dir in scope_dirs:
        dir_path = os.path.join(src_dir, scope_dir)
        if not os.path.exists(dir_path):
            continue
        for root, dirs, files in os.walk(dir_path):
            for f in sorted(files):
                if f.endswith('.py'):
                    filepath = os.path.join(root, f)
                    try:
                        if process_file(filepath):
                            rel = os.path.relpath(filepath, src_dir)
                            changed.append(rel)
                            print(f'  Migrated: {rel}')
                    except Exception as e:
                        rel = os.path.relpath(filepath, src_dir)
                        print(f'  ERROR in {rel}: {e}', file=sys.stderr)
    
    print(f'\nTotal files modified: {len(changed)}')


if __name__ == '__main__':
    main()
