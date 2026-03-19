# OSMO's Actual Primitives -- What Exists Today

This documents what OSMO's codebase actually provides as of March 2026. These are the building blocks that make OSMO an agentic substrate. Paths are relative to `src/`.

---

## Compute Primitives

### GPU Topology as Queryable Resource

**Location**: `utils/job/topology.py`

| Class | Purpose |
|-------|---------|
| `TopologyKey` | Named constraint (zone, rack, node) |
| `TopologyRequirement` | Required topology for a task |
| `TaskTopology` | Full topology spec per task |
| `TopologyTreeNode` | Tree structure for constraint solving |

Standard K8s treats GPUs as opaque integers. OSMO encodes GPU placement as constraint trees. An agent can reason: "64 GPUs needed, only 48 on same rack -- wait for colocation or accept cross-rack with reduced NVLink bandwidth?"

### Gang Scheduling via PodGroup

**Location**: `utils/job/` (`PodGroupTopologyBuilder`)

All-or-nothing GPU allocation via KAI Scheduler. Prevents deadlocks in tensor parallelism. Reduces utilization by 10-15% but prevents training job starvation.

### Multi-Cluster Heterogeneous Backends

**Location**: `service/agent/`, `operator/backend_listener.py`, `operator/backend_worker.py`

Training clusters, simulation clusters, edge devices -- each with different K8s configs, GPU types, network topologies. Backend lifecycle management with WebSocket-based status streams (node/pod/event/heartbeat).

### Pool-Based Resource Management

**Location**: `service/core/workflow/`, `service/core/config/`

Pools with GPU type, quota, and access control. Resource validation rules. Per-pool configuration.

---

## Workflow Primitives

### Multi-Stage Pipeline Orchestration

**Location**: `service/core/workflow/`

YAML-based workflow definitions. Submit/list/cancel/exec/logs. SDG -> Training -> Evaluation as composable stages with different compute requirements per stage.

### ctrl/user/rsync Container Model

**Location**: `runtime/cmd/ctrl/`, `runtime/cmd/user/`, `runtime/cmd/rsync/`

Three containers per workflow:
- **ctrl**: Orchestrator. WebSocket to workflow service. Unix socket to user. Manages data download/upload, barriers, port forwarding.
- **user**: Executor. PTY for user commands. Streams stdout/stderr to ctrl. Checkpointing (periodic uploads).
- **rsync**: Data synchronization daemon with bandwidth limiting.

IPC: WebSocket (ctrl <-> workflow service), Unix sockets (ctrl <-> user), gRPC (authz sidecar).

### Barrier Synchronization

**Location**: `service/logger/` (distributed barriers via Redis)

Multi-task coordination. Tasks can synchronize at checkpoints before proceeding. Critical for multi-GPU training coordination.

### Job Queue

**Location**: `service/worker/`, `service/delayed_job_monitor/`

Redis-backed Kombu queue with deduplication. `FrontendJob` subclasses. Delayed jobs via Redis ZSET with promotion to main queue.

---

## Data Primitives

### Multi-Cloud Storage SDK

**Location**: `lib/data/storage/`

| Class | Purpose |
|-------|---------|
| `Client` | Unified interface across 6 backends |
| `StorageBackend` | Backend abstraction (S3, Azure, GCS, Swift, TOS, local) |
| `ExecutorParameters` | Parallel multiprocess+multithread transfer config |
| `StoragePath` | Cross-backend path abstraction |

Streaming upload/download with checkpointing. Parallel execution across processes and threads.

### Dataset Management

**Location**: `lib/data/dataset/`, `service/core/data/`

Dataset lifecycle: upload, download, migrate, version, tag. Content-addressable deduplication. Collection management. Streaming downloads.

---

## Auth and Security Primitives

### Semantic RBAC

**Location**: `utils/roles/` (Go), `service/authz_sidecar/` (Go gRPC)

Actions: `workflow:Create`, `dataset:Read`, etc. LRU cache with TTL. Role sync from IDP. Pool access evaluation.

Flow: API gateway -> authz_sidecar extracts user/roles from headers -> resolves policies from cache/DB -> evaluates RBAC -> returns allow/deny with `x-osmo-user`, `x-osmo-roles`, `x-osmo-allowed-pools` headers.

### Secret Management

**Location**: `utils/secret_manager/`

JWE-based encryption/decryption. MEK/UEK key management. Credential management for workflows.

---

## Observability Primitives

### Monitoring Stack

- Prometheus + Grafana + Loki
- OpenTelemetry instrumentation on FastAPI
- GPU validation: nvidia-smi, tflops benchmarks, stuck pod detection (`operator/utils/node_validation_test/`)

### Log Streaming

**Location**: `service/logger/`

Receives structured logs from osmo-ctrl containers. Persists task metrics to PostgreSQL.

### Cluster Health

**Location**: `operator/backend_listener.py`, `operator/backend_worker.py`, `operator/backend_test_runner/`

Real-time cluster status via WebSocket. Job execution for backend validation tasks.

---

## API Surface

### Core Service REST API

**Location**: `service/core/service.py` (FastAPI)

121 routes across 6 submodules:
- `auth/` -- JWT lifecycle, access tokens, user management, roles
- `workflow/` -- submit, list, cancel, resource quota, pool allocation, credentials
- `config/` -- service/workflow/dataset config CRUD with versioning
- `data/` -- dataset/collection management, versioning, multi-backend storage
- `app/` -- workflow app lifecycle, YAML spec validation
- `profile/` -- user profiles, token identity, role/pool visibility

OpenAPI spec auto-generated: `bazel run //src/scripts:export_openapi`

### CLI

**Location**: `cli/`

Entry point: `cli.py` -> `main_parser.py` (argparse). Subcommands mirror API: workflow, data, dataset, app, config, profile, login, pool, resources, user, credential, access_token, bucket, task, version, backend.

### WebSocket Endpoints

- Router: exec, portforward, rsync (`service/router/`)
- Agent: cluster status streams (`service/agent/`)
- Logger: log streaming (`service/logger/`)
- Ctrl: workflow lifecycle (`runtime/cmd/ctrl/`)

---

## What's Missing for Agentic Use

These primitives exist but are not yet exposed for agent consumption:

1. **No MCP server** -- agents cannot call OSMO APIs as tools
2. **No agent-readable telemetry** -- GPU health data exists in operator but not in a format an agent can query
3. **No historical pipeline analytics** -- each run's data exists but there's no aggregate analysis (which configs produce good results)
4. **No cost estimation** -- no way to predict GPU-hours before submission
5. **No failure taxonomy** -- failures are logged but not categorized for agent diagnosis
6. **No workflow templates** -- no curated SDG -> train -> eval patterns as agent-consumable YAML

These gaps define the implementation work for the substrate design. See [substrate-design.md](substrate-design.md).
