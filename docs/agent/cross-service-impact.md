# Cross-Service Impact Map

When changing shared code, these services may be affected. Check before committing.

## Shared Libraries → Consumers

### `lib/data/storage/` (Multi-cloud storage SDK)
**Consumers** (changes here affect ALL of these):
- `service/core/data/` — dataset management, streaming downloads
- `lib/data/dataset/` — dataset lifecycle (upload, download, migrate)
- `runtime/pkg/data/` — Go runtime storage (parallel implementation)
- `cli/data.py` — CLI upload/download commands
- `tests/common/storage/` — test fixtures for S3/Swift/Redis

### `lib/data/dataset/` (Dataset manager)
**Consumers**:
- `service/core/data/` — dataset/collection management
- `cli/dataset.py` — CLI dataset commands
- `cli/data.py` — CLI data commands

### `lib/utils/` (Client SDK, errors, logging)
**Consumers** (changes here affect EVERYTHING):
- ALL Python services (`service/core/`, `service/router/`, `service/worker/`, `service/agent/`, `service/logger/`, `service/delayed_job_monitor/`)
- ALL CLI modules (`cli/`)
- `operator/` — backend listener/worker
- `tests/` — test utilities

### `utils/job/` (Workflow execution framework)
**Consumers**:
- `service/core/workflow/` — workflow submit/cancel
- `service/worker/` — job execution
- `operator/backend_worker.py` — backend job execution

### `utils/connectors/` (K8s, Postgres, Redis connectors)
**Consumers**:
- `service/core/` — all submodules using PostgreSQL
- `service/worker/` — Redis job queue
- `service/delayed_job_monitor/` — Redis scheduled jobs
- `operator/` — K8s cluster connections

### `utils/secret_manager/` (JWE encryption)
**Consumers**:
- `service/core/workflow/` — credential management
- `service/core/auth/` — token encryption

### `utils/roles/` (Go RBAC)
**Consumers**:
- `service/authz_sidecar/` — gRPC authorization
- Any Go service checking permissions

### `runtime/pkg/messages/` (IPC protocol)
**Consumers**:
- `runtime/cmd/ctrl/` — orchestrator
- `runtime/cmd/user/` — executor
- `service/logger/` — log streaming (receives messages)

## Database Schema
**Location**: `tests/common/database/testdata/schema.sql`

Schema changes affect:
- ALL services using PostgreSQL (core, worker, logger, delayed_job_monitor)
- `utils/postgres/` — Go PostgreSQL client
- pgroll migration scripts
- Test fixtures in `tests/common/database/`

## API Contract
**Location**: OpenAPI spec generated from `service/core/service.py`

API changes affect:
- `cli/` — CLI commands that call the API
- `ui/src/lib/api/generated.ts` — auto-generated frontend types
- `ui/src/lib/api/adapter/` — adapter layer for backend quirks
- `service/router/` — request routing
- MCP server tools (when implemented)

## Redis Schema
Changes to Redis key patterns or data structures affect:
- `service/worker/` — job queue (Kombu)
- `service/delayed_job_monitor/` — scheduled jobs (ZSET)
- `service/logger/` — distributed barriers
- `service/core/` — caching
- `utils/connectors/RedisConnector`
