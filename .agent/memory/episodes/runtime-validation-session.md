# Episode: Pydantic v2 Runtime Validation

**Date**: 2026-03-26
**Task**: Validate runtime behavior of Pydantic v1→v2 migration
**Outcome**: SUCCESS — 3 runtime bugs found and fixed

## Context
The Pydantic migration code changes were already done and all 138 tests passed. The job was to start actual services locally and find runtime errors that tests didn't catch.

## Infrastructure Setup
- Started Redis (port 6379) and PostgreSQL 15.1 (port 5432) in containers
- Built all service binaries with `bazel build`
- Started services with `--method=dev` flag to bypass MEK/secret manager requirements
- HOST_IP: 10.244.13.92

## Bugs Found and Fixed

### Bug #1: `_instance` Singleton on BaseModel Classes
- **Symptom**: `AttributeError` on startup — `_instance` became `ModelPrivateAttr` in Pydantic v2
- **Files**: `src/utils/static_config.py`, `src/service/core/workflow/objects.py`
- **Fix**: Changed `_instance = None` to `_instance: ClassVar[Optional['ClassName']] = None`
- **Lesson**: Pydantic v2 treats underscore-prefixed class attributes as private model attributes. Use `ClassVar` annotation to opt out.

### Bug #2: ResourceAssertion Read Path
- **Symptom**: `list()` returned when Pydantic expected `ResourceAssertion` — raw JSONB dicts from PostgreSQL weren't being constructed into model instances
- **File**: `src/utils/connectors/postgres.py` (`ResourceValidation.list_from_db()`)
- **Fix**: Wrap JSONB dict items with `ResourceAssertion(**item)` constructor
- **Lesson**: Pydantic v2 doesn't auto-coerce nested dicts to models in all contexts. Explicit construction needed when deserializing from DB.

### Bug #3: ResourceAssertion Write Path
- **Symptom**: `TypeError: Object of type ResourceAssertion is not JSON serializable` in `json.dumps()`
- **File**: `src/utils/connectors/postgres.py` (`PoolInfo.update_db()` and `PoolInfo.insert_into_db()`)
- **Fix**: Added `default=common.pydantic_encoder` to `json.dumps()` calls
- **Lesson**: Pydantic v2 models aren't JSON-serializable by default with stdlib `json.dumps()`. Need a custom encoder or use `.model_dump()`.

## Validation Results
- All 4 services (core, worker, delayed_job_monitor, router) start cleanly
- 20+ API endpoints tested (both read and write paths)
- CLI commands work against local instance (`osmo version`, `osmo pool list`, `osmo workflow list`)
- 138/138 bazel tests pass
- 67/67 Python files compile without errors
- Zero Pydantic-related errors in any service logs (grep across all 4 logs)

## Full CRUD Testing
- **resource_validation**: Create (PUT with 3 ResourceAssertion models) → Read → Delete → Verify deletion ✅
- **pool**: Create → Read → Patch → Rename → Delete → Verify deletion ✅
  - 500 errors from missing backend are expected business logic, not Pydantic issues
- **group_template**: PUT passes Pydantic validation; 400 from app-level validation (expected)
- All errors in service logs are expected business logic: "Backend default not found" (no runtime backend in dev mode)

## API Endpoints Tested
### Read (all 200 OK):
- /api/version, /api/docs, /api/openapi.json
- /api/pool, /api/resources
- /api/configs/service, /api/configs/resource_validation, /api/configs/group_template
- /api/configs/pod_template, /api/configs/history, /api/configs/diff
- /api/workflow, /api/workflow/list, /api/task
- /api/plugins/configs
- /api/configs/pool, /api/configs/pool/default
- Router /version (port 8001)

### Write (all Pydantic serialization/deserialization correct):
- PUT/DELETE /api/configs/resource_validation/{name}
- PUT/PATCH/DELETE /api/configs/pool/{name}
- PUT /api/configs/pool/{name}/rename
