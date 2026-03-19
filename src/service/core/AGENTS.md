# Core Service — Agent Context

The main FastAPI microservice. Entry point: `service.py`.

## Submodules

| Module | Purpose | Key Patterns |
|--------|---------|-------------|
| `auth/` | JWT token lifecycle, access tokens, user management, role assignment | JWT creation/refresh, RBAC role sync from IDP |
| `workflow/` | Workflow submit/list/cancel, resource quota, pool allocation, task coordination, credential management | YAML spec validation, pool selection, gang scheduling triggers |
| `config/` | Service/workflow/dataset configuration CRUD with versioning and history | Versioned configs, pod templates, resource validation rules |
| `data/` | Dataset/collection management, versioning with tags, multi-backend storage, streaming downloads | Storage SDK integration, content-addressable dedup |
| `app/` | Workflow app lifecycle (create, version, rename, delete), YAML spec validation | App versioning, spec schema validation |
| `profile/` | User profile/preferences, token identity, role/pool visibility | Identity from JWT, preference persistence |

## How Requests Flow

```
Client → API Gateway → authz_sidecar (gRPC)
  → Sets x-osmo-user, x-osmo-roles, x-osmo-allowed-pools headers
  → Core Service FastAPI handler
  → Handler reads headers (trusts authz_sidecar — NO permission checks in handlers)
  → Business logic → PostgreSQL / Redis / downstream services
  → Response
```

**Important**: Core service handlers NEVER check permissions directly. They trust the `x-osmo-*` headers set by the authz_sidecar. If a new endpoint needs different permissions, configure the authz_sidecar.

## Error Handling

All errors inherit from `OSMOError` in `lib/utils/`. Use the appropriate subclass:
- `NotFoundError` — resource doesn't exist
- `ConflictError` — resource already exists or version conflict
- `ValidationError` — invalid input
- `PermissionError` — insufficient permissions (rare — authz_sidecar handles most)

FastAPI exception handlers in `service.py` map these to HTTP status codes.

## Database Access

- PostgreSQL via `utils/connectors/PostgresConnector`
- pgx connection pool (Go) / psycopg (Python)
- Schema: `tests/common/database/testdata/schema.sql`
- Migrations: pgroll

## Key Dependencies

- `lib/utils/` — client SDK, error types, logging
- `utils/job/` — workflow execution framework (for submit)
- `utils/connectors/` — PostgreSQL, Redis connectors
- `utils/secret_manager/` — credential encryption

## Testing

- Python tests under `tests/` using pytest + testcontainers
- Database fixtures: `tests/common/database/`
- API tests use FastAPI's test client
- Run: `bazel test //src/service/core/...`
