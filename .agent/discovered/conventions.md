# Conventions (from AGENTS.md and CLAUDE.md)

## Code Style
- All imports at top level (no function-level imports)
- No abbreviations in variable names
- Strict typing with type annotations
- Prefer dataclasses over dicts for structured data
- No `assert` in production code (only tests)
- Copyright: "All rights reserved." on same line as "NVIDIA CORPORATION & AFFILIATES"
- If copyright lines exceed 100 chars, add `# pylint: disable=line-too-long`

## Pydantic Patterns Used
- `import pydantic` (qualified access: `pydantic.BaseModel`, `pydantic.Field`, etc.)
- Classes use `pydantic.BaseModel` with `extra=pydantic.Extra.forbid` in class args
- Inner `class Config:` for settings like `arbitrary_types_allowed`, `use_enum_values`
- `@pydantic.validator()` and `@pydantic.root_validator()` decorators
- `pydantic.Field(regex=...)` for pattern validation
- `pydantic.dataclasses.dataclass` for some data classes
- `.dict()` and `.json()` methods on model instances
- `pydantic.error_wrappers.ValidationError` for exception catching
- `pydantic.SecretStr` for sensitive fields
- One `pydantic.BaseSettings` usage

## Commit Convention
- Prefix: `agent(pydantic-v2)`
