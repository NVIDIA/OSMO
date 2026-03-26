#!/usr/bin/env python3
"""
Pydantic v1 to v2 migration script for the OSMO repository.
This handles the mechanical patterns. Complex cases need manual review.
"""
import re
import sys
import os

def migrate_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Replace pydantic.Extra.forbid -> 'forbid', pydantic.Extra.allow -> 'allow', pydantic.Extra.ignore -> 'ignore'
    content = content.replace('pydantic.Extra.forbid', "'forbid'")
    content = content.replace('pydantic.Extra.allow', "'allow'")
    content = content.replace('pydantic.Extra.ignore', "'ignore'")
    
    # 2. Replace .dict() -> .model_dump() on pydantic models
    # We need to be careful not to replace dict() on non-pydantic objects
    # But in this codebase, .dict() is almost always on pydantic models
    content = content.replace('.dict()', '.model_dump()')
    
    # 3. Replace .json() on pydantic models -> .model_dump_json()
    # This is trickier - need to identify pydantic model .json() calls
    # We'll handle specific known patterns
    # NOT replacing: response.json(), result.json() (HTTP responses)
    # The comment in ctrl_websocket.py mentions logs.json() 
    
    # 4. Replace @pydantic.validator -> @pydantic.field_validator with mode='before' for pre=True
    # and add @classmethod decorator
    # This needs careful regex work
    
    # 5. Replace @pydantic.root_validator -> @pydantic.model_validator
    
    # 6. Replace class Config: with model_config = ConfigDict(...)
    
    # 7. Replace __fields__ with model_fields
    content = content.replace('cls.__fields__', 'cls.model_fields')
    content = content.replace('self.__fields__', 'self.model_fields')
    
    # 8. Replace .construct( -> .model_construct(
    # Need to be careful - only replace when it's on a pydantic model class
    # In this codebase: ResourcesEntry.construct, BackendResource.construct, ListEntry.construct, etc.
    content = content.replace('.construct(', '.model_construct(')
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

if __name__ == '__main__':
    # Find all Python files that import pydantic
    src_dir = '/workspace/repo/src'
    changed = []
    for root, dirs, files in os.walk(src_dir):
        for fname in files:
            if fname.endswith('.py'):
                fpath = os.path.join(root, fname)
                with open(fpath, 'r') as f:
                    if 'pydantic' in f.read():
                        if migrate_file(fpath):
                            changed.append(fpath)
    
    for f in sorted(changed):
        print(f"Modified: {f}")
    print(f"\nTotal files modified: {len(changed)}")
