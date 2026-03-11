# AGENTS.md

This file provides guidance to AI agents when working with the OSMO codebase.

## Overview

OSMO is a workflow orchestration platform for Physical AI, managing heterogeneous Kubernetes clusters for training, simulation, and edge compute workloads.

## Workflow Requirements

Before making any code changes in this repo, you MUST:

1. **Explore first**: Use the Codebase Structure section below to orient yourself, then read relevant source files before proposing changes. Read existing implementations, tests, and related modules. Never modify code you haven't read.
2. **Plan before implementing**: For any non-trivial change (more than a simple one-line fix), create an explicit plan that identifies:
  - Which files need to change and why
  - How the change fits with existing patterns in the codebase
  - What tests exist and what new tests are needed
  - Any cross-cutting concerns (e.g., auth, storage backends, IPC protocols)
  - A verification plan: how to confirm the change works (e.g., specific tests to run, build commands, manual checks)
3. **Check for downstream impact**: This is a multi-service platform — changes in shared libraries (`lib/`, `utils/`) can affect multiple services. Grep for usages before modifying shared code.
4. **Verify after implementation**: After completing changes, execute the verification plan — run the relevant tests/builds and confirm they pass before claiming the work is done. Never assert success without evidence.
5. **Simplify before committing**: Review your changes for unnecessary complexity, redundancy, and over-engineering before committing. Prefer the simplest solution that meets the requirements.
6. **Update documentation**: If adding, removing, or renaming a service, module, or major component, update the "Codebase Structure" section in this file as part of the same change.

## Team Guidelines

- Follow existing code patterns and conventions in the codebase
- Use Bazel for builds and testing
- Go code follows standard Go conventions
- Write self-describing code; avoid redundant comments that simply restate what the code does
- Copyright headers must keep "All rights reserved." on the same line as "NVIDIA CORPORATION & AFFILIATES"
- If copyright lines exceed 100 characters, add `# pylint: disable=line-too-long` comment instead of breaking into multiple lines

## Python Coding Standards

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

## Codebase Structure (`src/`)

All paths below are relative to `src/`.

### Core Service (`service/core/`) — Main FastAPI Microservice

Entry point: `service/core/service.py`. Framework: FastAPI + Uvicorn + OpenTelemetry.

| Submodule | Purpose |
|-----------|---------|
| `auth/` | JWT token lifecycle, access token CRUD, user management, role assignment |
| `workflow/` | Workflow submit/list/cancel, resource quota, pool allocation, task coordination, credential management |
| `config/` | Service/workflow/dataset configuration CRUD with versioning and history. Pod templates, resource validation rules, pool/backend config |
| `data/` | Dataset/collection management, versioning with tags, multi-backend storage, streaming downloads |
| `app/` | Workflow app lifecycle (create, version, rename, delete), YAML spec validation |
| `profile/` | User profile/preferences, token identity, role/pool visibility |

**Error types**: Defined in `lib/utils/` — see the `OSMOError` hierarchy for the full list.

### Supporting Services

| Service | Purpose |
|---------|---------|
| `service/router/` | Routes HTTP/WebSocket requests to backends. Sticky session routing. WebSocket endpoints for exec, portforward, rsync. |
| `service/worker/` | Kombu-based Redis job queue consumer. Deduplicates jobs. Executes `FrontendJob` subclasses. |
| `service/agent/` | Backend cluster integration via WebSocket. Receives node/pod/event/heartbeat streams from K8s clusters. |
| `service/logger/` | Receives structured logs from osmo-ctrl containers. Persists task metrics to PostgreSQL. Distributed barriers via Redis. |
| `service/delayed_job_monitor/` | Polls Redis for scheduled jobs, promotes to main queue when ready. |

### Python Libraries (`lib/`)

| Library | Key Classes | Purpose |
|---------|-------------|---------|
| `lib/data/storage/` | `Client`, `StorageBackend`, `ExecutorParameters`, `StoragePath` | Multi-cloud storage SDK (S3, Azure, GCS, Swift, TOS). Parallel multiprocess+multithread executor. Streaming upload/download. |
| `lib/data/dataset/` | `Manager` | Dataset lifecycle (upload, download, migrate) built on storage SDK. |
| `lib/utils/` | `LoginManager`, `ServiceClient`, `OSMOError` hierarchy | Client SDK for HTTP/WebSocket requests with JWT auth. Error types, logging, validation, credential management. |
| `lib/rsync/` | `RsyncClient` | File watch-based rsync with debounce/reconciliation. Port forwarding for remote access. |

### Python Utilities (`utils/`)

| Module | Key Classes | Purpose |
|--------|-------------|---------|
| `utils/job/` | `Task`, `FrontendJob`, `K8sObjectFactory`, `PodGroupTopologyBuilder` | Workflow execution framework. Task → K8s spec generation. Gang scheduling via PodGroup. Topology constraints. Backend job definitions. |
| `utils/connectors/` | `ClusterConnector`, `PostgresConnector`, `RedisConnector` | K8s API wrapper, PostgreSQL operations, Redis job queue management. |
| `utils/secret_manager/` | `SecretManager` | JWE-based secret encryption/decryption. MEK/UEK key management. |
| `utils/progress_check/` | — | Liveness/progress tracking for long-running services. |
| `utils/metrics/` | — | Prometheus metrics collection and export. |

### CLI (`cli/`)

Entry point: `cli.py` → `main_parser.py` (argparse). Subcommand modules:


| Module                                                                                                         | Commands                         |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `workflow.py`                                                                                                  | submit, list, cancel, exec, logs |
| `data.py`                                                                                                      | upload, download, list, delete   |
| `dataset.py`                                                                                                   | Dataset management               |
| `app.py`                                                                                                       | App submission/management        |
| `config.py`                                                                                                    | Service configuration            |
| `profile.py`                                                                                                   | User profiles                    |
| `login.py`                                                                                                     | Authentication                   |
| `pool.py`, `resources.py`, `user.py`, `credential.py`, `access_token.py`, `bucket.py`, `task.py`, `version.py` | Supporting commands              |
| `backend.py`                                                                                                   | Backend cluster management       |

Features: Tab completion (shtab), response formatting (`formatters.py`), spec editor (`editor.py`), PyInstaller packaging (`cli_builder.py`, `packaging/`).

### Go Runtime Containers (`runtime/`)

| Binary | Purpose |
|--------|---------|
| `runtime/cmd/ctrl/` | **osmo_ctrl** — Orchestrates workflow execution. WebSocket to workflow service. Unix socket to osmo_user. Manages data download/upload, barriers for multi-task sync, port forwarding. |
| `runtime/cmd/user/` | **osmo_user** — Executes user commands with PTY. Streams stdout/stderr to ctrl. Handles checkpointing (periodic uploads). |
| `runtime/cmd/rsync/` | **osmo_rsync** — Rsync daemon with bandwidth limiting. |

### Go Runtime Packages (`runtime/pkg/`)

| Package | Purpose |
|---------|---------|
| `args/` | CLI flag parsing for ctrl and user containers. |
| `messages/` | IPC message protocol between containers (exec lifecycle, log streaming, barriers). |
| `common/` | Shared utilities: command execution, file operations, circular buffer. |
| `data/` | Input/output data handling. Storage backend abstraction (S3, Swift, GCS, TOS). Mount/download/upload with retry and checkpointing. |
| `metrics/` | Execution timing and data transfer metrics collection. |
| `osmo_errors/` | Error handling with categorized exit codes and termination logging. |
| `rsync/` | Rsync daemon subprocess management with monitoring. |

### Go Utilities (`utils/` — Go)

| Package | Purpose |
|---------|---------|
| `roles/` | Semantic RBAC. Actions like `workflow:Create`, `dataset:Read`. LRU cache with TTL. Role sync from IDP. Pool access evaluation. |
| `postgres/` | PostgreSQL client with pgx connection pool and pgroll schema version support. |
| `redis/` | Redis client with optional TLS. |
| `logging/` | Structured slog handler compatible with Fluent Bit parsers. |
| `env.go` | Environment variable helpers with YAML config file fallback. |

### Authorization Sidecar (`service/authz_sidecar/`) — Go gRPC

- Implements external authorization for the API gateway
- Flow: Extract user/roles from request headers → sync roles from IDP → resolve role policies from cache/DB → evaluate semantic RBAC → return allow/deny with `x-osmo-user`, `x-osmo-roles`, `x-osmo-allowed-pools` headers

### Frontend (`ui/`)

- **Framework**: Next.js (App Router, Turbopack) + React + TypeScript (see `package.json` for versions)
- **Styling**: Tailwind CSS + shadcn/ui
- **State**: TanStack Query (data fetching), Zustand (UI state), nuqs (URL state)
- **Testing**: Vitest (unit), Playwright (E2E), MSW (API mocking)
- **API layer**: OpenAPI-generated types (`lib/api/generated.ts` — DO NOT EDIT) + adapter layer (`lib/api/adapter/`) that bridges backend quirks to UI expectations
- **Key routes**: pools, resources, workflows, datasets, occupancy, profile, log-viewer (under `app/(dashboard)/`)
- **Import rules**: Absolute imports only (`@/...`), no barrel exports, API types from adapter (not generated)

### Operator (`operator/`)

- `backend_listener.py` — WebSocket listener for backend cluster status
- `backend_worker.py` — Job execution engine for backend tasks
- `backend_test_runner/` — Test orchestration for backend validation
- `utils/node_validation_test/` — GPU validation (nvidia-smi, tflops benchmark, stuck pod detection)
### Tests


| Location                                    | Framework                      | Scope                                                                                                                                                      |
| ------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/common/`                             | pytest + testcontainers        | Shared fixtures: PostgreSQL (`database/`), S3/Swift/Redis storage (`storage/`), Docker network/registry (`core/`, `registry/`), Envoy TLS proxy (`envoy/`) |
| `tests/common/database/testdata/schema.sql` | —                              | Database schema definition (source of truth for test DB)                                                                                                   |
| `runtime/pkg/*_test.go`                     | Go testing + testcontainers-go | Runtime package unit/integration tests                                                                                                                     |
| `utils/*_test.go`                           | Go testing                     | Go utility tests (roles, postgres, redis)                                                                                                                  |
| `ui/src/**/*.test.ts`                       | Vitest                         | Frontend unit tests                                                                                                                                        |
| `ui/e2e/`                                   | Playwright                     | Frontend E2E tests with page object models                                                                                                                 |

### Key Architecture Patterns

- **Container runtime**: Three container types per workflow — ctrl (orchestrator), user (execution), data (rsync sidecar)
- **IPC**: WebSocket (ctrl↔workflow service), Unix sockets (ctrl↔user), gRPC (authz sidecar)
- **Auth**: API gateway → authz_sidecar (semantic RBAC with `x-osmo-user`, `x-osmo-roles`, `x-osmo-allowed-pools` headers)
- **Storage**: Multi-cloud abstraction (S3/Azure/GCS/Swift/TOS) with parallel multiprocess+multithread transfer
- **Job queue**: Redis-backed Kombu queue with deduplication. Delayed jobs via Redis ZSET.
- **Databases**: PostgreSQL (pgx), Redis (caching + job queue + event streams + barriers), pgroll for schema versioning
- **Monitoring**: Prometheus + Grafana + Loki. OpenTelemetry instrumentation on FastAPI.

### Inter-Service Communication

```
Client → API Gateway → authz_sidecar (gRPC Check) → Core Service (FastAPI)
                                                         ├── PostgreSQL (state)
                                                         ├── Redis (cache, job queue, events)
                                                         ├── → Worker (job consumer)
                                                         ├── ↔ Agent (WebSocket backend events)
                                                         ├── ↔ Logger (WebSocket log streaming)
                                                         ├── → Router (HTTP/WS request routing)
                                                         └── → Delayed Job Monitor (scheduled jobs)

Workflow Execution:
  Core Service → K8s Backend → [osmo_ctrl ↔ osmo_user ↔ osmo_rsync]
  osmo_ctrl ↔ Core Service (WebSocket)
  osmo_ctrl → Logger (WebSocket logs/metrics)
```

### Build & Test

- **Build system**: Bazel (`MODULE.bazel`, `.bazelrc`) — check `MODULE.bazel` for current version
- **Python**: ruff linter (`.ruff.toml`, Google style) — check `MODULE.bazel` for Python version
- **Go**: module `go.corp.nvidia.com/osmo` (single `go.mod` at `src/`) — check `go.mod` for Go version
- **Frontend**: Next.js + pnpm, TypeScript strict mode, ESLint + Prettier — check `ui/package.json` for versions
- **Tests**: Bazel test rules, pytest + testcontainers (Python), testcontainers-go (Go), Vitest + Playwright (frontend)
- **Container images**: Built via `rules_oci` (amd64, arm64), distroless base from NVIDIA NGC
- **API spec**: OpenAPI auto-generated from FastAPI via `bazel run //src/scripts:export_openapi`

