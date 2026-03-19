# Agent Decision Tree: Task Routing

Given a task description, this tree identifies which files and modules to read first.

## By Task Type

### "Add/modify an API endpoint"
1. Read `src/service/core/AGENTS.md` — understand core service structure
2. Read the specific submodule (`auth/`, `workflow/`, `config/`, `data/`, `app/`, `profile/`)
3. Check `AGENTS.md` > "Inter-Service Communication" — will other services be affected?
4. Check `docs/agent/cross-service-impact.md` — downstream effects of API changes
5. Run `scripts/agent/route-context.sh <file-path>` for file-specific context

### "Add/modify a CLI command"
1. Read `src/cli/main_parser.py` — entry point, subcommand registration
2. Read the specific CLI module (e.g., `workflow.py`, `data.py`)
3. Check if corresponding API endpoint exists in `service/core/`
4. Read `src/lib/utils/` — client SDK for HTTP/WebSocket requests

### "Change storage/dataset behavior"
1. Read `src/lib/AGENTS.md` — library context
2. Read `src/lib/data/storage/` — multi-cloud storage SDK
3. Read `src/lib/data/dataset/` — dataset lifecycle
4. Check `docs/agent/cross-service-impact.md` — storage changes affect many services

### "Change Go runtime behavior (ctrl/user/rsync)"
1. Read `src/runtime/AGENTS.md` — runtime context
2. Read the specific binary (`cmd/ctrl/`, `cmd/user/`, `cmd/rsync/`)
3. Read `runtime/pkg/messages/` — IPC message protocol
4. Read `runtime/pkg/data/` — storage backend abstraction in Go
5. Check Go test files (`*_test.go`) in the same package

### "Change authorization/RBAC"
1. Read `src/utils/roles/` (Go) — semantic RBAC implementation
2. Read `src/service/authz_sidecar/` (Go) — gRPC authorization service
3. Read `src/service/core/auth/` (Python) — JWT lifecycle
4. Check `AGENTS.md` > "Auth" pattern — API gateway -> authz_sidecar flow

### "Change frontend UI"
1. Read `src/ui/AGENTS.md` — frontend coding standards and patterns
2. Read the specific route under `app/(dashboard)/`
3. Check `src/lib/api/adapter/` — adapter layer for backend data
4. Check `src/lib/api/adapter/BACKEND_TODOS.md` — known backend quirks

### "Change workflow execution (job scheduling, topology)"
1. Read `src/utils/job/` — Task, FrontendJob, K8sObjectFactory, PodGroupTopologyBuilder
2. Read `src/utils/job/topology.py` — GPU topology constraints
3. Read `src/service/worker/` — job queue consumer
4. Check `src/service/delayed_job_monitor/` — scheduled jobs

### "Change infrastructure (Helm, Terraform, Ansible)"
1. This is outside `src/` — check the parent repo's CLAUDE.md
2. Read the relevant directory (`charts/`, `terraform/`, `ansible/`)
3. Check `argocd/` for GitOps deployment configs

### "Fix a bug"
1. Identify which service is affected (use grep for error messages/function names)
2. Read the relevant service's AGENTS.md
3. Read existing tests for the affected code
4. Check `docs/agent/cross-service-impact.md` if the fix touches shared code

### "Add/run tests"
1. Check `AGENTS.md` > "Tests" table for test framework per location
2. Python: pytest + testcontainers, fixtures in `tests/common/`
3. Go: `go test` + testcontainers-go, `*_test.go` files
4. Frontend: Vitest (unit), Playwright (E2E), MSW (mocking)
5. All: Bazel test rules

## By File Location

Use `scripts/agent/route-context.sh <file-path>` for automated routing. Manual fallback:

| File starts with... | Read first |
|---------------------|-----------|
| `src/service/core/` | `src/service/core/AGENTS.md` |
| `src/service/router/` or `service/worker/` or `service/agent/` or `service/logger/` | `AGENTS.md` > Supporting Services |
| `src/lib/` | `src/lib/AGENTS.md` |
| `src/runtime/` | `src/runtime/AGENTS.md` |
| `src/utils/` (Python) | `AGENTS.md` > Python Utilities |
| `src/utils/` (Go) | `AGENTS.md` > Go Utilities |
| `src/cli/` | `AGENTS.md` > CLI |
| `src/ui/` | `src/ui/AGENTS.md` |
| `src/service/authz_sidecar/` | `AGENTS.md` > Authorization Sidecar |
| `src/operator/` | `AGENTS.md` > Operator |
