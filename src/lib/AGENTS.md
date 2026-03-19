# Python Libraries — Agent Context

Shared Python libraries used across all services and CLI.

## `lib/data/storage/` — Multi-Cloud Storage SDK

The storage SDK is OSMO's most widely used library. Changes here affect MANY consumers.

| Class | Purpose |
|-------|---------|
| `Client` | Unified interface across 6 backends. Entry point for all storage operations. |
| `StorageBackend` | Abstract base class. Implementations: S3, Azure, GCS, Swift, TOS, local. |
| `ExecutorParameters` | Configuration for parallel multiprocess+multithread transfer. |
| `StoragePath` | Cross-backend path abstraction. Encodes bucket, prefix, backend type. |

**Key patterns**:
- All operations go through `Client`, never directly through a backend
- Parallel transfer uses multiprocess + multithread (configurable via `ExecutorParameters`)
- Streaming upload/download with checkpointing for large files
- Content-addressable deduplication for dataset versioning

**Cross-service impact**: Changes to `Client` or `StorageBackend` API affect:
- `service/core/data/` — dataset management
- `lib/data/dataset/` — dataset lifecycle
- `runtime/pkg/data/` — Go runtime (parallel implementation, must stay compatible)
- `cli/data.py` — CLI commands
- `tests/common/storage/` — test fixtures

## `lib/data/dataset/` — Dataset Manager

| Class | Purpose |
|-------|---------|
| `Manager` | Dataset lifecycle: upload, download, migrate, version, tag. |

Built on the storage SDK. Handles multi-backend operations, versioning with tags, collection management.

## `lib/utils/` — Client SDK and Utilities

| Class | Purpose |
|-------|---------|
| `LoginManager` | JWT authentication, token refresh, credential storage. |
| `ServiceClient` | HTTP/WebSocket client with JWT auth. Used by CLI and services. |
| `OSMOError` hierarchy | Base error types: NotFoundError, ConflictError, ValidationError, etc. |

**Cross-service impact**: `lib/utils/` is imported by EVERY Python module. Changes here require broad verification.

## `lib/rsync/` — Rsync Client

| Class | Purpose |
|-------|---------|
| `RsyncClient` | File watch-based rsync with debounce/reconciliation. Port forwarding. |

Used by CLI for remote file synchronization.

## Testing

- Storage tests: `tests/common/storage/` (S3, Swift, Redis fixtures using testcontainers)
- Run: `bazel test //src/lib/...`
