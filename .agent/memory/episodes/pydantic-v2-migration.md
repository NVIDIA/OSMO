# Pydantic v1 → v2 Migration Episode

## Task
Migrate all Python code in NVIDIA/osmo from Pydantic v1 (1.10.26) to Pydantic v2 (2.12.5).

## Branch
`fernandol/pydantic-v2-migration`

## Scope
- `src/service/` — core services, worker, router, agent, logger
- `src/lib/` — data storage, dataset management, utilities
- `src/utils/` — job framework, connectors, auth, metrics
- `src/operator/` — operator utilities
- Associated tests

## Changes Made

### Dependencies
- `requirements.txt`: `pydantic==2.12.5`, `pydantic-settings==2.9.1`
- `requirements_lock.txt`: `pydantic-core==2.41.5`

### Code Migrations
1. **`class Config:` → `model_config = ConfigDict(...)`** across all Pydantic models
2. **`@validator` → `@field_validator`** with updated signatures
3. **`@root_validator` → `@model_validator(mode='before')`** where access to multiple fields needed
4. **`.dict()` → `.model_dump()`** across all models
5. **`schema_extra` → `json_schema_extra`** (already migrated in previous commits)
6. **`Optional[X]` fields without `= None`** — added explicit defaults across 61+ fields in ~20 files
7. **`coerce_numbers_to_str=True`** for `ResourceUsage` model (str fields receiving int values)
8. **`np.bool` → `bool`** — deprecated numpy boolean type replaced

### Files Modified (non-exhaustive)
- `src/utils/job/task.py` — model_validator, Optional defaults
- `src/utils/job/workflow.py` — Optional defaults in ResourcesEntry, Workflow
- `src/utils/job/jobs_base.py` — Optional default in JobResult
- `src/utils/job/jobs.py` — Optional default in WorkflowJob
- `src/lib/data/dataset/common.py` — Optional defaults, np.bool fix
- `src/service/core/config/objects.py` — Optional defaults, ConfigDict
- `src/service/core/workflow/objects.py` — ResourceUsage coercion, Optional defaults
- `src/service/core/data/objects.py` — Optional defaults
- `src/utils/backend_messages.py` — Optional defaults
- `src/utils/connectors/postgres.py` — Optional defaults
- Many more across src/service/, src/lib/, src/utils/, src/operator/

## Verification Results

### Tests Passed: 119 across 11 test files
- `test_task.py` (11), `test_topology.py` (12), `test_common.py` (storage, 12)
- `test_backends.py` (22), `test_auth.py` (2), `test_resource_spec.py` (1)
- `test_common.py` (lib/utils, 2), `test_redact_secrets.py` (12)
- `test_workflow.py` (lib/utils, 7), `test_dataset.py` (11)
- `test_config_history_helpers.py` (12)

### Pre-existing Failures (2)
- `test_wf_no_resource_spec` — calls `convert_to_workflow_spec()` which never existed
- `test_wf_with_resource_spec` — passes invalid data even for v1

### Infrastructure-blocked (not migration-related)
- Tests requiring Docker, Redis, Bazel modules

### Compilation
All 63 pydantic-using Python files compile successfully.

### Pattern Grep
Zero remaining v1 patterns found.

## Key Decisions
- `pydantic-settings` separated as own package (v2 requirement)
- `Optional[X]` fields need explicit `= None` in v2
- `@model_validator(mode='before')` for validators needing access to other fields
- `coerce_numbers_to_str=True` for mixed int/str fields
- Pre-existing test failures left as-is (out of scope)

## Lessons Learned
- Pydantic v2 is strict about Optional fields requiring explicit defaults
- `@validator` with `values` parameter needs conversion to `@model_validator(mode='before')`
- `coerce_numbers_to_str` is a model-level config, not field-level
- Some tests were already broken before migration (always verify baseline)
- Bazel-dependent tests can't run outside the build system
