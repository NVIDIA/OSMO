# OSMO Repository Knowledge

## Project Structure
- `src/service/` - Service layer (router, worker, agent, logger, auth)
- `src/lib/` - Shared libraries (data storage, utilities)
- `src/utils/` - Utilities (connectors, job management, metrics, auth)
- `src/operator/` - Kubernetes operator
- `src/cli/` - CLI tools

## Build System
- Uses Bazel (bzlmod with MODULE.bazel)
- Python dependencies via pip.parse in MODULE.bazel
- Main deps: `src/requirements.txt` → locked as `src/locked_requirements.txt`
- Test deps: `src/tests/requirements.txt` → locked similarly
- Bazel import path uses `services.` prefix for some modules (e.g., `from services.utils.metrics.metrics import *`)

## Pydantic Usage Patterns
- Heavy use of pydantic BaseModel throughout codebase
- Custom `StaticConfig` pattern in `utils/static_config.py` using `model_fields` and `json_schema_extra`
- Custom Field kwargs (command_line, env, action) stored in `json_schema_extra`
- `ExtraArgBaseModel` in postgres.py for dynamic extra field handling
- Storage backends use `Literal` types for const scheme fields

## Testing
- Tests organized in `tests/` subdirectories alongside source
- Bazel test targets defined in BUILD files
- Some tests can run with pytest + PYTHONPATH=src
- Some tests require Bazel for import path resolution (services.* imports)
