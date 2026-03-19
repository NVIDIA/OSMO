# Architecture Intent

Why the system is designed this way. Consult this when a change feels architecturally ambiguous.

## Core Design Decisions

### Three-Container Runtime Model (ctrl/user/rsync)
**Why**: Security isolation. The user container runs arbitrary user code. The ctrl container orchestrates and has privileged access (WebSocket to service, data management). Separating them means a buggy user process can't corrupt orchestration state. The rsync container provides data synchronization without either container managing file transfers directly.

**Implication**: Never merge ctrl and user functionality. If you need ctrl capabilities from user code, go through the Unix socket IPC.

### WebSocket for Long-Lived Connections, HTTP for Request-Response
**Why**: Workflow execution can run for hours. HTTP timeouts would kill long-running operations. WebSocket provides bidirectional streaming for ctrl↔service, agent↔service, and logger↔service communication.

**Implication**: Don't replace WebSocket endpoints with HTTP polling. Don't add new HTTP endpoints for streaming data — use the existing WebSocket infrastructure.

### Redis for Everything Ephemeral, PostgreSQL for Everything Durable
**Why**: Redis handles job queues (Kombu), caching, event streams, distributed barriers, and scheduled jobs (ZSET). It's fast and disposable — losing Redis data means re-queuing jobs, not losing state. PostgreSQL stores all durable state: workflows, datasets, users, configurations, metrics.

**Implication**: Never store durable state in Redis alone. Never use PostgreSQL for high-frequency ephemeral data (barriers, cache).

### Semantic RBAC (Not Path-Based)
**Why**: Path-based RBAC (`/api/workflow/*`) is brittle — it breaks when URLs change. Semantic RBAC (`workflow:Create`, `dataset:Read`) is stable across API refactors.

**Implication**: New endpoints need semantic action annotations, not URL-pattern ACLs. The authz_sidecar resolves actions, not paths.

### Multi-Cloud Storage Abstraction
**Why**: Users have data in different clouds. Forcing migration to a single backend is a non-starter. The 6-backend SDK (S3/Azure/GCS/Swift/TOS/local) with parallel transfer enables OSMO to work wherever the data already lives.

**Implication**: Never add storage features that work with only one backend. All storage operations must go through the `StorageBackend` abstraction.

### Gang Scheduling via PodGroup
**Why**: Training jobs need all GPUs simultaneously. Without all-or-nothing allocation, two 32-GPU jobs could each get 48 of 64 GPUs and deadlock. PodGroup prevents this, at the cost of 10-15% utilization reduction.

**Implication**: Don't bypass PodGroup for "efficiency." The deadlock prevention is more valuable than the utilization gain.

### API Gateway → authz_sidecar → Core Service
**Why**: Separation of concerns. The API gateway handles TLS/routing. The authz_sidecar handles authentication and authorization (gRPC Check). The core service handles business logic. This means core service code never needs to check permissions — it trusts the headers set by authz_sidecar.

**Implication**: Don't add auth checks inside core service handlers. If a new endpoint needs different permissions, configure the authz_sidecar.

## Boundary Rules

### Python ↔ Go Boundary
- Python: services, CLI, operator, libraries (`lib/`, `utils/` Python)
- Go: runtime containers (ctrl/user/rsync), authz sidecar, utilities (`utils/` Go)
- Communication: WebSocket (ctrl↔service), gRPC (authz), Unix socket (ctrl↔user)
- **Never**: Python code calling Go code directly or vice versa. Always through network protocols.

### Service ↔ Service Boundary
- Services communicate through: HTTP (sync), Redis queue (async), WebSocket (streaming)
- **Never**: Direct function imports between services. Each service is independently deployable.
- Shared code lives in `lib/` (Python) or `utils/` (Go), not in service directories.

### Frontend ↔ Backend Boundary
- Frontend communicates through: HTTP REST API, WebSocket (exec, portforward, logs)
- Adapter layer (`ui/src/lib/api/adapter/`) bridges backend quirks to UI expectations
- **Never**: Frontend code making assumptions about backend internals. Use the adapter.

## When to Consult This Document

- You're adding a new service or communication channel
- You're considering merging two components
- You're unsure whether something belongs in Redis vs. PostgreSQL
- You're adding a new storage backend
- You're changing the auth flow
- A change crosses a language boundary (Python ↔ Go)
