# Go Runtime — Agent Context

Three container types that execute workflows. Written in Go.

## Binaries (`cmd/`)

### `cmd/ctrl/` — osmo_ctrl (Orchestrator)
The orchestration container. Manages the workflow execution lifecycle.

**Responsibilities**:
- WebSocket connection to workflow service (receives commands, sends status)
- Unix socket connection to osmo_user (sends exec commands, receives stdout/stderr)
- Data download/upload management (pre-exec download, post-exec upload)
- Barrier synchronization for multi-task coordination
- Port forwarding for remote access
- Checkpoint management (coordinates with osmo_user for periodic uploads)

**Key pattern**: ctrl is the ONLY container that talks to the workflow service. User code cannot directly communicate with OSMO services.

### `cmd/user/` — osmo_user (Executor)
The execution container. Runs user commands.

**Responsibilities**:
- Executes user commands with PTY (pseudo-terminal)
- Streams stdout/stderr to ctrl via Unix socket
- Handles checkpointing (periodic data uploads when configured)
- Manages user process lifecycle (start, signal, terminate)

**Key pattern**: user runs ARBITRARY user code. It has NO privileged access. All orchestration goes through ctrl via Unix socket IPC.

### `cmd/rsync/` — osmo_rsync (Data Sync)
The data synchronization sidecar.

**Responsibilities**:
- Rsync daemon with bandwidth limiting
- File synchronization between container and storage

## Packages (`pkg/`)

| Package | Purpose | Key Types |
|---------|---------|-----------|
| `args/` | CLI flag parsing for ctrl and user | Shared configuration structs |
| `messages/` | IPC message protocol between containers | `ExecRequest`, `ExecResponse`, `LogMessage`, `BarrierSync` |
| `common/` | Shared utilities: command execution, file operations, circular buffer | `CommandRunner`, `FileHelper` |
| `data/` | Storage backend abstraction (S3, Swift, GCS, TOS) | `StorageClient`, `DownloadManager`, `UploadManager` |
| `metrics/` | Execution timing and data transfer metrics | `Timer`, `TransferMetrics` |
| `osmo_errors/` | Error handling with categorized exit codes | `ExitCode`, `TerminationLog` |
| `rsync/` | Rsync daemon subprocess management | `Daemon`, `Monitor` |

## IPC Protocol

```
ctrl ←→ user:     Unix socket (messages/ package)
ctrl ←→ service:  WebSocket (workflow lifecycle)
ctrl → logger:    WebSocket (structured logs, metrics)
```

**Message types** (defined in `pkg/messages/`):
- Exec lifecycle: start, signal, exit
- Log streaming: stdout, stderr
- Barrier sync: wait, release
- Data operations: download start/complete, upload start/complete

## Go Module

- Module path: `go.corp.nvidia.com/osmo`
- Single `go.mod` at `src/` level
- Check `go.mod` for Go version

## Testing

- Unit tests: `*_test.go` files in each package
- Integration tests: testcontainers-go for storage backends
- Run: `bazel test //src/runtime/...`

## Critical Constraints

1. **Never bypass Unix socket IPC**: ctrl↔user communication MUST go through the messages package
2. **Never add network access to user container**: user runs untrusted code
3. **Storage operations must use the abstraction**: Never call S3/GCS/etc. directly
4. **Exit codes are categorized**: Use `osmo_errors` package, not raw exit codes
5. **Metrics must be reported**: All data transfers and exec timings go through `metrics` package
