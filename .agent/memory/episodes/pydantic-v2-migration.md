# Pydantic V2 Migration Episode

## Task
Migrate all Python code in NVIDIA/osmo repo from Pydantic v1 (1.10.26) to Pydantic v2 (2.12.5).

## Scope
`src/service/`, `src/lib/`, `src/utils/`, `src/operator/`, `src/cli/`

## Changes Made

### 1. Import/API Changes
- `pydantic.Extra.forbid/allow/ignore` → string literals `"forbid"/"allow"/"ignore"`
- `pydantic.error_wrappers.ValidationError` → `pydantic.ValidationError`
- `pydantic.BaseSettings` → `pydantic_settings.BaseSettings` (in executor.py)

### 2. Model Method Changes
- `.dict()` → `.model_dump()` (~68 occurrences across all files)
- `.json()` → `.model_dump_json()` (on pydantic models only)
- `.copy()` → `.model_copy()` (test_service.py)
- `.construct()` → `.model_construct()` (6 occurrences in workflow, postgres, objects)

### 3. Class Config → model_config
- All `class Config:` inner classes → `model_config = pydantic.ConfigDict(...)` (~19 files)
- `keep_untouched=(property,)` → `ignored_types=(property,)` (auth.py)
- `env_prefix` → `SettingsConfigDict(env_prefix=...)` (executor.py)
- Custom non-standard options in jobs_base.py removed

### 4. Validator Changes
- `@pydantic.validator` → `@pydantic.field_validator` with `@classmethod` (~52 occurrences)
- `@pydantic.root_validator` → `@pydantic.model_validator(mode='before')` with `@classmethod` (~20 occurrences)
- `pydantic.FieldValidationInfo` → `pydantic.ValidationInfo` (5 occurrences)
- `values` parameter → `info: pydantic.ValidationInfo` with `info.data[...]` access

### 5. Field Changes
- `Field(regex=...)` → `Field(pattern=...)` (including client.py missed in earlier pass)
- `Field(const=True)` → `Literal[value]` type annotation (11 occurrences in storage backends)
- `Field(min_items=)` → `Field(min_length=)` (2 occurrences in postgres.py)
- `Field(required=True)` → removed (field is required if no default) (3 occurrences in operator/objects.py)
- Custom extra kwargs (`command_line=`, `env=`, `action=`, `type=`) → `json_schema_extra={...}` (17 files)

### 6. Model API Changes
- `cls.__fields__` → `cls.model_fields` (5 files)
- `field.field_info.extra` → `field.json_schema_extra` (static_config.py)
- `field.field_info.description` → `field.description` (static_config.py)
- `field.required` → `field.is_required()` (static_config.py)
- `field.outer_type_` → `field.annotation` (static_config.py)
- `field.name` → use dict key from `model_fields.items()` (static_config.py)
- `cls.__config__.extra` → `cls.model_config['extra']` (postgres.py ExtraArgBaseModel)

### 7. Behavior Changes
- Added `coerce_numbers_to_str=True` to Version model (version.yaml has int values loaded as str fields)
- Updated `mode='before'` model validator in workflow.py to handle dict access pattern (raw dicts not yet validated as models)
- Added v2 error type names to static_config.py error handling

### 8. Dependencies
- `src/requirements.txt`: `pydantic==2.12.5`, `pydantic-settings==2.9.1`
- `src/locked_requirements.txt`: regenerated via pip-compile
- `src/lib/data/storage/core/BUILD`: added `requirement("pydantic-settings")`

## Test Results
- 92 tests pass (resource spec, task, topology, storage backends, common, dataset, redact secrets, workflow)
- Pre-existing failures unrelated to pydantic: jinja sandbox (subprocess), kb_objects (assertEquals deprecated in Python 3.12), workflow test (convert_to_workflow_spec undefined)
- Cannot run Bazel tests (no GCC/CC compiler in container)
- Cannot run service tests (Bazel path mapping `from services.utils.metrics.metrics` not available outside Bazel)

## Key Decisions
- Used `mode='before'` for all root_validator migrations (receives dict, preserving `values` access pattern)
- Used `json_schema_extra` for custom Field kwargs (command_line, env, action, type)
- Used `Literal[value]` for `const=True` fields in storage backends
- Used `coerce_numbers_to_str=True` for Version model instead of changing field types
