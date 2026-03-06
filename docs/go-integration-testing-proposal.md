# Go Integration Testing Infrastructure Proposal

## Background

### Current Python Approach

The Python codebase (`src/tests/common/`) uses **testcontainers-python** with `unittest.TestCase` to manage real containerized dependencies for integration tests. Key characteristics:

- **Fixture hierarchy via inheritance**: `NetworkFixture -> ReaperFixture -> OsmoTestFixture -> PostgresFixture`, etc.
- **Real containers**: PostgreSQL (15.1), Redis, LocalStack (S3), Swift, Docker Registry, Envoy SSL proxy — all run as Docker containers.
- **Per-test isolation**: `PostgresTestIsolationFixture` backs up all public tables to a `backup` schema in `setUp()` and restores them in `tearDown()`, avoiding full container restarts between tests.
- **Shared Docker network**: A bridge network is created per test session, enabling inter-container communication.
- **Reusable via composition**: Tests inherit from multiple fixture classes (e.g., `class MyTest(PostgresFixture, RedisStorageFixture)`) to compose the dependencies they need.

The goal is to build an equivalent system in Go, starting with the **authz_sidecar** (which depends on PostgreSQL), and design it for reuse across future Go services.

### Current Go State

- **Module**: `go.corp.nvidia.com/osmo` (Go 1.24.3, Bazel build)
- **authz_sidecar dependencies**: PostgreSQL (via `pgx/v5`), gRPC, Envoy ext_authz API, in-memory LRU caches
- **Existing tests**: Unit tests only (table-driven, standard `testing.T`). Integration tests are `manual`/`local` tagged in Bazel and require manually running services.
- **No shared test helpers package** exists today.

---

## Available Tools for Go Integration Testing

### 1. testcontainers-go

**What it is**: The Go port of the testcontainers library. Manages Docker containers programmatically from test code.

**Pros**:
- Direct analog to the Python testcontainers approach already used in the codebase — same mental model for developers working in both languages.
- Rich module ecosystem with pre-built modules for PostgreSQL, Redis, LocalStack, etc.
- Programmatic container lifecycle control (start, stop, wait-for-ready).
- Supports custom Docker networks for multi-container communication.
- Container reuse mode (`testcontainers.WithReuseEnabled`) to speed up repeated local runs.
- Active community, well-maintained, CNCF ecosystem.
- Works with standard `go test` and Bazel.

**Cons**:
- Requires Docker daemon access at test time (may need DinD in CI).
- Container startup adds latency per test suite (~1-3s for PostgreSQL).
- Bazel sandboxing can conflict with Docker socket access — tests need `local = True` or `tags = ["manual"]`.
- Heavier than pure in-process alternatives.

**Key dependency**: `github.com/testcontainers/testcontainers-go` + modules (e.g., `testcontainers-go/modules/postgres`)

### 2. dockertest (ory/dockertest)

**What it is**: A lightweight Go library for running Docker containers in tests, originally from Ory (makers of Hydra/Kratos).

**Pros**:
- Simpler API than testcontainers-go — fewer abstractions, less magic.
- Built-in retry/health-check helpers (`pool.Retry()`).
- Lightweight, minimal dependencies.
- Well-proven (used heavily in Ory's own integration tests).
- Easy resource cleanup via `pool.Purge(resource)`.

**Cons**:
- Smaller ecosystem — no pre-built "modules" like testcontainers. You configure containers manually (image, ports, env vars).
- Less active development compared to testcontainers-go.
- No built-in container reuse between runs.
- Still requires Docker daemon access.
- Less feature-rich for advanced scenarios (custom networks, wait strategies).

**Key dependency**: `github.com/ory/dockertest/v3`

### 3. embedded-postgres (fergusstrange/embedded-postgres)

**What it is**: Downloads and runs a real PostgreSQL binary in-process, no Docker required.

**Pros**:
- No Docker dependency — works anywhere Go compiles.
- Fast startup (~1-2s, sometimes faster with caching of the PG binary).
- Simpler CI setup — no DinD needed, works in Bazel sandbox.
- Deterministic — same PG binary version every time.

**Cons**:
- **PostgreSQL only** — doesn't solve Redis, S3, or other dependencies. Not a general-purpose solution.
- Platform-specific binaries (may cause issues with cross-compilation or exotic CI architectures).
- Less control over PostgreSQL configuration compared to a full container.
- Not a perfect replica of production (different from containerized PG in subtle ways).

**Key dependency**: `github.com/fergusstrange/embedded-postgres`

### 4. sqlc/pgx test utilities + manual Docker Compose

**What it is**: Use `docker-compose` to start dependencies externally, and connect from Go tests using standard `pgx` connection logic with build tags or environment variables.

**Pros**:
- Familiar `docker-compose.yml` files, easy to understand.
- No Go library dependency for container management.
- Full control over container configuration.
- Matches how the services run in production (if using compose there too).

**Cons**:
- Requires manual setup step before running tests (or a Makefile/script wrapper).
- Harder to integrate with `go test` and Bazel — tests can't self-provision their dependencies.
- Port conflicts if multiple test suites run in parallel.
- No per-test isolation without additional work.
- Not self-contained — new developers must know to run compose first.

### 5. gnomock

**What it is**: Similar to testcontainers but Go-native, with pre-built "presets" for common services.

**Pros**:
- Go-native design with idiomatic API.
- Pre-built presets: PostgreSQL, Redis, LocalStack, MySQL, MongoDB, etc.
- Lightweight container management.
- Supports health checks and initialization hooks.

**Cons**:
- Smaller community and less active than testcontainers-go.
- Fewer presets than testcontainers modules.
- Still requires Docker.
- Less mature documentation and ecosystem support.

**Key dependency**: `github.com/orlangure/gnomock`

---

## Recommendation: testcontainers-go

**testcontainers-go** is the best fit for this project because:

1. **Consistency with Python**: The Python test infrastructure already uses testcontainers. Using the Go port maintains a unified mental model across the codebase. Developers switching between Python and Go tests will find familiar patterns.

2. **Extensibility**: The authz_sidecar currently only needs PostgreSQL, but as more Go services are written, they may need Redis, S3/LocalStack, or other dependencies. testcontainers-go has the broadest module ecosystem to support this growth.

3. **Self-contained tests**: Tests provision their own dependencies — no manual `docker-compose up` step. This is critical for CI and developer experience.

4. **Active ecosystem**: Most widely used, best documented, and most actively maintained option.

---

## Proposed Implementation

### Package Structure

Go test fixtures are co-located with the existing Python test fixtures in
`src/tests/common/`, sharing the same directory structure. Python uses `*.py`
files and Go uses `*.go` files; Bazel has separate targets for each language.

```
src/
  tests/
    common/
      database/
        postgres.py                      # Python PostgresFixture (existing)
        postgres_fixture.go              # Go PostgresFixture (NEW)
        BUILD                            # Both py_library and go_library targets
      storage/
        redis.py                         # Python RedisFixture (existing)
        redis_fixture.go                 # Go RedisFixture (future)
      core/
        network.py                       # Python NetworkFixture (existing)
        network.go                       # Go Docker network management (future)
  service/
    authz_sidecar/
      server/
        authz_server_integration_test.go # NEW: integration tests
        testdata/
          schema.sql                     # Database schema for tests
          seed.sql                       # Seed data for tests
```

### Core Design: `testutil` Package

The `testutil` package mirrors the Python `tests/common/` fixtures but uses Go conventions (helper functions returning cleanup funcs, `testing.TB` interface).

#### `testutil/postgres.go`

```go
package testutil

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	DefaultPostgresImage    = "postgres:15.1"
	DefaultPostgresDB       = "osmo_db"
	DefaultPostgresUser     = "postgres"
	DefaultPostgresPassword = "osmo_pass"
)

// PostgresContainer holds a running PostgreSQL container and its connection pool.
type PostgresContainer struct {
	Container testcontainers.Container
	Pool      *pgxpool.Pool
	ConnStr   string
	Host      string
	Port      string
}

// PostgresOption configures the PostgreSQL container.
type PostgresOption func(*postgresConfig)

type postgresConfig struct {
	image    string
	dbName   string
	user     string
	password string
	initSQL  []string // SQL files to run on startup
}

func WithPostgresImage(image string) PostgresOption {
	return func(c *postgresConfig) { c.image = image }
}

func WithInitSQL(paths ...string) PostgresOption {
	return func(c *postgresConfig) { c.initSQL = append(c.initSQL, paths...) }
}

// StartPostgres creates and starts a PostgreSQL container for testing.
// It registers cleanup with t.Cleanup() so the container is automatically
// stopped when the test finishes.
func StartPostgres(t testing.TB, opts ...PostgresOption) *PostgresContainer {
	t.Helper()

	cfg := &postgresConfig{
		image:    DefaultPostgresImage,
		dbName:   DefaultPostgresDB,
		user:     DefaultPostgresUser,
		password: DefaultPostgresPassword,
	}
	for _, opt := range opts {
		opt(cfg)
	}

	ctx := context.Background()

	containerOpts := []testcontainers.ContainerCustomizer{
		postgres.WithDatabase(cfg.dbName),
		postgres.WithUsername(cfg.user),
		postgres.WithPassword(cfg.password),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(30 * time.Second),
		),
	}

	for _, sqlFile := range cfg.initSQL {
		containerOpts = append(containerOpts, postgres.WithInitScripts(sqlFile))
	}

	container, err := postgres.Run(ctx, cfg.image, containerOpts...)
	if err != nil {
		t.Fatalf("failed to start postgres container: %v", err)
	}

	t.Cleanup(func() {
		if err := container.Terminate(ctx); err != nil {
			t.Logf("failed to terminate postgres container: %v", err)
		}
	})

	connStr, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("failed to get postgres connection string: %v", err)
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to create connection pool: %v", err)
	}
	t.Cleanup(pool.Close)

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("failed to get container host: %v", err)
	}

	mappedPort, err := container.MappedPort(ctx, "5432")
	if err != nil {
		t.Fatalf("failed to get mapped port: %v", err)
	}

	return &PostgresContainer{
		Container: container,
		Pool:      pool,
		ConnStr:   connStr,
		Host:      host,
		Port:      mappedPort.Port(),
	}
}
```

#### `testutil/testutil.go`

```go
package testutil

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ResetDatabase truncates all user-created tables in the public schema.
// Use this in between tests for isolation (analogous to Python's
// PostgresTestIsolationFixture).
func ResetDatabase(t testing.TB, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	rows, err := pool.Query(ctx, `
		SELECT tablename FROM pg_tables
		WHERE schemaname = 'public'
	`)
	if err != nil {
		t.Fatalf("failed to list tables: %v", err)
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("failed to scan table name: %v", err)
		}
		tables = append(tables, name)
	}

	for _, table := range tables {
		if _, err := pool.Exec(ctx, "TRUNCATE TABLE "+table+" CASCADE"); err != nil {
			t.Fatalf("failed to truncate table %s: %v", table, err)
		}
	}
}
```

### Usage in authz_sidecar Integration Tests

```go
//go:build integration

package server_test

import (
	"context"
	"testing"

	"go.corp.nvidia.com/osmo/testutil"
	"go.corp.nvidia.com/osmo/utils/roles"
)

func TestAuthzCheckWithDatabase(t *testing.T) {
	// Start a real PostgreSQL container — cleaned up automatically.
	pg := testutil.StartPostgres(t,
		testutil.WithInitSQL("testdata/schema.sql", "testdata/seed.sql"),
	)

	// Build the server under test with the real DB connection.
	server := NewAuthzServer(pg.Pool, /* other deps */)

	t.Run("admin role has full access", func(t *testing.T) {
		testutil.ResetDatabase(t, pg.Pool)
		seedAdminRole(t, pg.Pool)

		resp, err := server.Check(context.Background(), adminCheckRequest())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Status.Code != 0 {
			t.Errorf("expected OK, got %v", resp.Status)
		}
	})

	t.Run("unauthorized user is denied", func(t *testing.T) {
		testutil.ResetDatabase(t, pg.Pool)

		resp, err := server.Check(context.Background(), unprivilegedCheckRequest())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Status.Code == 0 {
			t.Error("expected denial, got OK")
		}
	})
}
```

### Bazel Integration

```starlark
go_test(
    name = "integration_test",
    srcs = ["authz_server_integration_test.go"],
    tags = [
        "integration",
        "manual",    # Don't run in default test suite
    ],
    local = True,    # Needs Docker socket access
    deps = [
        "//src/testutil",
        "//src/service/authz_sidecar/server",
        # ... other deps
    ],
)
```

Tests can be run explicitly:

```bash
bazel test //src/service/authz_sidecar/server:integration_test --test_tag_filters=integration
```

### Per-Test Isolation Strategy

Two approaches, matching what the Python side does:

| Approach | How | When to use |
|---|---|---|
| **TRUNCATE** | `ResetDatabase()` clears all tables between subtests | Fast, works when schema is stable |
| **Transaction rollback** | Wrap each test in a transaction, rollback after | Fastest, but doesn't work if the code under test manages its own transactions |

The Python infrastructure uses the backup-schema approach (copy tables to `backup` schema, restore after each test). In Go, the simpler TRUNCATE approach is recommended initially, with the option to add snapshot/restore if needed.

### Build Tag Convention

Use `//go:build integration` build tags to separate integration tests from unit tests:

- **Unit tests** (`_test.go`): No build tag, run by default with `go test` / `bazel test`.
- **Integration tests** (`_integration_test.go`): Tagged with `//go:build integration`, require explicit opt-in.

This mirrors the existing Bazel `tags = ["manual"]` pattern but also works with plain `go test -tags=integration`.

### Future Extensions

The `testutil` package can grow to support additional fixtures as Go services expand:

```
testutil/
  postgres.go       # PostgreSQL (done)
  redis.go           # Redis container fixture
  s3.go              # LocalStack/S3 fixture
  network.go         # Shared Docker network for multi-container tests
  grpc.go            # gRPC test server helpers
  testutil.go        # Common helpers (ResetDatabase, etc.)
```

Each follows the same pattern: `Start<Service>(t testing.TB, opts ...) -> *<Service>Container` with automatic `t.Cleanup()` registration.

---

## Comparison Summary

| Criteria | testcontainers-go | dockertest | embedded-postgres | docker-compose | gnomock |
|---|---|---|---|---|---|
| Docker required | Yes | Yes | No | Yes | Yes |
| Multi-service support | Many modules | Manual config | PG only | Full | Some presets |
| Pre-built PG module | Yes | No | N/A | N/A | Yes |
| API complexity | Medium | Low | Low | N/A | Medium |
| Community/maintenance | High | Medium | Medium | N/A | Low |
| Consistency with Python | High (same family) | Low | Low | Low | Low |
| Bazel compatibility | Needs `local=True` | Needs `local=True` | Works in sandbox | External step | Needs `local=True` |
| Container reuse | Built-in | No | N/A | Manual | No |
| Init scripts (schema) | Built-in | Manual | Built-in | Via volume mount | Built-in |

---

## Next Steps

1. Add `testcontainers-go` and its PostgreSQL module to `go.mod`.
2. Create the `src/testutil/` package with `postgres.go` and `testutil.go`.
3. Write the first integration test for authz_sidecar's `Check()` endpoint using a real PostgreSQL container.
4. Update Bazel BUILD files with the integration test target.
5. Verify CI can run the tests (Docker socket access in the test environment).
