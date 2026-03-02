# AGENTS.md

This file provides guidance to AI agents when working with the OSMO codebase.

## Overview

OSMO is a workflow orchestration platform for Physical AI, managing heterogeneous Kubernetes clusters for training, simulation, and edge compute workloads.

## Team Guidelines

- Follow existing code patterns and conventions in the codebase
- Use Bazel for builds and testing
- Go code follows standard Go conventions
- Write self-describing code; avoid redundant comments that simply restate what the code does
- Copyright headers must keep "All rights reserved." on the same line as "NVIDIA CORPORATION & AFFILIATES"
- If copyright lines exceed 100 characters, add `# pylint: disable=line-too-long` comment instead of breaking into multiple lines

## Tool Usage Preferences

- Use specialized tools (Read, Edit, Write, Grep, Glob) instead of Bash commands whenever possible
- Bash tools require user intervention to allow and should only be used as a last resort
- Prefer Read over cat, Edit over sed, Write over echo/heredoc, Grep over grep, and Glob over find

## Coding Standards

### Import Statements
- All imports must be at the top level of the module
- Place all imports at the top of the file after the module docstring
- **No exceptions**: Imports inside functions are not allowed
  - If circular dependencies exist, the code must be refactored to remove them
  - Common refactoring strategies:
    - Extract shared code into a separate module
    - Use dependency inversion (import abstractions, not concrete implementations)
    - Restructure module hierarchy to break the cycle
    - Use late binding or forward references for type hints (PEP 563)

### Variable Naming
- Do not use abbreviations in variable names unless they are well-understood abbreviations or common conventions
- **Good**: `topology_key`, `config`, `i` (iterator), `x`, `y`, `z` (coordinates)
- **Bad**: `tk` (for topology_key), `topo` (for topology), `req` (for requirement)
- Use full, descriptive names that make code self-documenting

### Type Annotations and Data Structures
- **Use strict typing**: Add type annotations where they improve code clarity and catch errors
- **Prefer dataclasses over dictionaries**: When passing structured data with multiple fields, use dataclasses instead of `Dict[str, Any]`
  - **Good**: `@dataclasses.dataclass class TaskTopology: name: str; requirements: List[...]`
  - **Bad**: `task_data: Dict[str, Any] = {'name': ..., 'requirements': ...}`
- **Avoid unnecessary Optional types**: Only use `Optional[T]` or `T | None` when there is a meaningful behavioral difference between None and an empty value
  - **Good**: `def process(items: List[str])` - caller passes empty list if no items
  - **Bad**: `def process(items: Optional[List[str]])` - now caller must handle None case unnecessarily
  - **When None is meaningful**: Use Optional when None has a distinct meaning from empty (e.g., "not provided" vs "provided but empty")
- **Default arguments for mutable types**: Always use `None` as the default and convert to empty list/dict inside the function
  - **Reason**: Python evaluates default arguments once at function definition time, not per invocation
  - **Good**: `def process(items: List[str] | None = None) -> None: items = items if items is not None else []`
  - **Bad**: `def process(items: List[str] = []) -> None:` - all callers share the same list instance!

### Assertions
- **Do not use `assert` statements in production code** - only in unit tests
- **Reason**: Assertions can be disabled with Python's `-O` flag and should not be relied upon for runtime validation
- **Use proper error handling instead**: Raise appropriate exceptions (ValueError, TypeError, etc.) for validation
  - **Good**: `if value is None: raise ValueError("Value cannot be None")`
  - **Bad**: `assert value is not None, "Value cannot be None"`
