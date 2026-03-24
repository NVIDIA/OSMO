#!/usr/bin/env python3
"""
Migrate pydantic.Field() calls with extra kwargs to use json_schema_extra.

In pydantic v1, Field() accepted arbitrary kwargs stored in field.field_info.extra.
In pydantic v2, these must be passed via json_schema_extra={}.

Also migrates:
- field.field_info.extra -> field.json_schema_extra
- field.field_info.description -> field.description
- field.required -> field.is_required()
- field.outer_type_ -> field.annotation
- cls.__fields__ -> cls.model_fields
- field.name -> (use the key from model_fields dict)
"""

import re
import os


KNOWN_EXTRA_KWARGS = {'command_line', 'env', 'action', 'type'}
# These are standard pydantic.Field kwargs that should NOT be moved to json_schema_extra
STANDARD_FIELD_KWARGS = {
    'default', 'default_factory', 'alias', 'title', 'description', 
    'gt', 'ge', 'lt', 'le', 'multiple_of', 'strict', 'min_length', 'max_length',
    'pattern', 'discriminator', 'json_schema_extra', 'frozen', 'validate_default',
    'repr', 'init', 'init_var', 'kw_only', 'exclude', 'include', 'deprecated',
    'examples', 'regex',  # regex already migrated to pattern
}


def process_field_extras(filepath):
    """Process Field() calls to move extra kwargs to json_schema_extra."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    if 'pydantic.Field(' not in content:
        return False
    
    original = content
    
    # Find all pydantic.Field(...) calls and check for extra kwargs
    # This is complex to do with regex, so let's use a line-by-line approach
    lines = content.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Check if this line starts a pydantic.Field( call
        if 'pydantic.Field(' in line:
            # Collect the full Field() call (may span multiple lines)
            field_lines = [line]
            open_parens = line.count('(') - line.count(')')
            
            while open_parens > 0 and i + 1 < len(lines):
                i += 1
                field_lines.append(lines[i])
                open_parens += lines[i].count('(') - lines[i].count(')')
            
            # Join and process the full field call
            full_field = '\n'.join(field_lines)
            new_field = migrate_field_call(full_field)
            result.append(new_field)
        else:
            result.append(line)
        
        i += 1
    
    content = '\n'.join(result)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False


def migrate_field_call(field_text):
    """Migrate a single pydantic.Field() call to use json_schema_extra for extra kwargs."""
    # Find the pydantic.Field( and its arguments
    match = re.search(r'pydantic\.Field\(', field_text)
    if not match:
        return field_text
    
    start = match.end()
    
    # Find matching closing paren
    depth = 1
    pos = start
    while depth > 0 and pos < len(field_text):
        if field_text[pos] == '(':
            depth += 1
        elif field_text[pos] == ')':
            depth -= 1
        pos += 1
    
    end = pos - 1  # Position of closing paren
    args_str = field_text[start:end]
    
    # Parse the arguments
    args = smart_split_args(args_str)
    
    standard_args = []
    extra_args = {}
    
    for arg in args:
        arg = arg.strip()
        if not arg:
            continue
        
        # Check if this is a keyword argument
        eq_match = re.match(r'^(\w+)\s*=\s*', arg)
        if eq_match:
            key = eq_match.group(1)
            value = arg[eq_match.end():]
            
            if key in KNOWN_EXTRA_KWARGS and key not in STANDARD_FIELD_KWARGS:
                extra_args[key] = value.strip()
            else:
                standard_args.append(arg)
        else:
            # Positional argument
            standard_args.append(arg)
    
    if not extra_args:
        return field_text  # No changes needed
    
    # Build json_schema_extra dict
    extra_items = []
    for key, value in extra_args.items():
        extra_items.append(f"'{key}': {value}")
    extra_dict = '{' + ', '.join(extra_items) + '}'
    
    # Add json_schema_extra to standard args
    standard_args.append(f'json_schema_extra={extra_dict}')
    
    # Reconstruct the Field call
    # Preserve the original indentation
    prefix = field_text[:match.start()]
    suffix = field_text[end + 1:]
    
    # Check if the original was multi-line
    if '\n' in args_str:
        # Multi-line format - indent each arg
        indent_match = re.search(r'\n(\s+)', args_str)
        if indent_match:
            arg_indent = indent_match.group(1)
        else:
            arg_indent = '        '
        
        new_args = (',\n' + arg_indent).join(a.strip() for a in standard_args)
        new_field = f'{prefix}pydantic.Field(\n{arg_indent}{new_args}){suffix}'
    else:
        # Single line
        new_args = ', '.join(a.strip() for a in standard_args)
        new_field = f'{prefix}pydantic.Field({new_args}){suffix}'
    
    return new_field


def smart_split_args(s):
    """Split arguments by commas, respecting nested structures."""
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
        elif char in ('(', '[', '{'):
            depth += 1
            current.append(char)
        elif char in (')', ']', '}'):
            depth -= 1
            current.append(char)
        elif char == ',' and depth == 0:
            parts.append(''.join(current))
            current = []
        else:
            current.append(char)
    
    if current:
        text = ''.join(current).strip()
        if text:
            parts.append(''.join(current))
    
    return parts


def process_static_config(filepath):
    """Migrate static_config.py to use v2 model_fields API."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Replace __fields__ with model_fields
    content = content.replace('cls.__fields__', 'cls.model_fields')
    
    # Replace field.field_info.extra with field.json_schema_extra
    content = content.replace('field.field_info.extra', 'field.json_schema_extra')
    content = content.replace('field.field_info.description', 'field.description')
    
    # Replace field.required with field.is_required()
    content = content.replace('not field.required', 'not field.is_required()')
    
    # Replace field.outer_type_ with field.annotation
    content = content.replace('field.outer_type_', 'field.annotation')
    
    # field.name -> name (the key from model_fields iteration)
    # This is already correct since we iterate with `for name, field in cls.model_fields.items()`
    
    with open(filepath, 'w') as f:
        f.write(content)


def process_backend_messages(filepath):
    """Migrate __fields__ references in backend_messages.py."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    content = content.replace('cls.__fields__', 'cls.model_fields')
    content = content.replace('self.__fields__', 'self.model_fields')
    
    with open(filepath, 'w') as f:
        f.write(content)


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
                    if process_field_extras(filepath):
                        rel_path = os.path.relpath(filepath, src_dir)
                        print(f'  Migrated Field extras: {rel_path}')
    
    # Process static_config.py
    static_config = os.path.join(src_dir, 'utils', 'static_config.py')
    if os.path.exists(static_config):
        process_static_config(static_config)
        print('  Migrated: utils/static_config.py (__fields__ -> model_fields)')
    
    # Process backend_messages.py
    backend_msgs = os.path.join(src_dir, 'utils', 'backend_messages.py')
    if os.path.exists(backend_msgs):
        process_backend_messages(backend_msgs)
        print('  Migrated: utils/backend_messages.py (__fields__ -> model_fields)')
    
    # Process service/core/workflow/objects.py
    workflow_objects = os.path.join(src_dir, 'service', 'core', 'workflow', 'objects.py')
    if os.path.exists(workflow_objects):
        with open(workflow_objects, 'r') as f:
            content = f.read()
        content = content.replace('cls.__fields__', 'cls.model_fields')
        content = content.replace('self.__fields__', 'self.model_fields')
        with open(workflow_objects, 'w') as f:
            f.write(content)
        print('  Migrated: service/core/workflow/objects.py (__fields__ -> model_fields)')
    
    # Process service/logger/ctrl_websocket.py
    ctrl_ws = os.path.join(src_dir, 'service', 'logger', 'ctrl_websocket.py')
    if os.path.exists(ctrl_ws):
        with open(ctrl_ws, 'r') as f:
            content = f.read()
        content = content.replace('cls.__fields__', 'cls.model_fields')
        with open(ctrl_ws, 'w') as f:
            f.write(content)
        print('  Migrated: service/logger/ctrl_websocket.py (__fields__ -> model_fields)')


if __name__ == '__main__':
    main()
