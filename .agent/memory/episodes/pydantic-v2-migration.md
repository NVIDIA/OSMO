# Pydantic v2 Migration Episode

## Task
Migrate OSMO repository from Pydantic v1 (1.10.26) to Pydantic v2 (2.12.5).

## Branch
`fernandol/pydantic-v2-migration`

## Final Commit
`0ecb288` — "agent(pydantic-v2): Replace deprecated np.bool with builtin bool"

## What Was Done
1. Updated `requirements.txt`: `pydantic==2.12.5`, `pydantic-settings==2.9.1`
2. Updated `requirements_lock.txt`: added `pydantic-core==2.41.5`
3. Migrated all v1 patterns:
   - `@validator` → `@field_validator`
   - `@root_validator` → `@model_validator`
   - `.dict()` → `.model_dump()`
   - `.schema()` → `.model_json_schema()`
   - `class Config:` → `model_config = ConfigDict(...)`
   - `pydantic.Extra.forbid` → `extra='forbid'` keyword arg
   - `update_forward_refs()` removed
4. Fixed `Optional[X]` fields without `= None` defaults across 61+ fields in 270 Pydantic models
5. Fixed `@field_validator` that needed access to other fields → `@model_validator(mode='before')`
6. Fixed `ResourceUsage` coercion: `coerce_numbers_to_str=True`
7. Fixed `np.bool` deprecation → `bool`

## Test Results (120 tests passed)
- All 120 runnable tests pass
- 4 pre-existing test failures (not migration-related)
- 8 tests blocked by infrastructure (redis, docker, Bazel services module)

## Key Decisions
- `pydantic-settings` must be separate package in v2
- Use `coerce_numbers_to_str=True` for ResourceUsage (ints → str fields)
- `@model_validator(mode='before')` for validators needing cross-field access
- All `Optional[X]` fields require explicit `= None` in v2
- Pre-existing broken tests (`test_workflow.py` with `convert_to_workflow_spec`) are out of scope

## Gotchas for Future Agents
- Pydantic v2 requires `Optional` fields to have explicit `= None` defaults
- Pydantic v2 `@field_validator` does NOT receive `values` parameter — use `@model_validator` instead
- `pydantic.Extra.forbid` is removed — use `extra='forbid'` in class definition or `ConfigDict`
- Many tests require Bazel build system (`services.utils.metrics` module path)
- `test_workflow.py` tests have always been broken — `convert_to_workflow_spec()` was never implemented
