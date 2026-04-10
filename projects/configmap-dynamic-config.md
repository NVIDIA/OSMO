<!--
Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# ConfigMap-Sourced Dynamic Configuration

**Author**: @vvnpn-nv<br>
**PIC**: @vvnpn-nv<br>
**Status**: v3 — authz_sidecar reads from file, product defaults in chart, zero DB for config

## Overview

Enable OSMO's configuration to be defined declaratively in Kubernetes ConfigMaps via Helm values, served from in-memory cache, and automatically reloaded on file changes. This follows the standard K8s pattern used by CoreDNS, Prometheus, NGINX Ingress, and Grafana: ConfigMap mounted as file, parsed into memory, served from memory, file watcher detects changes.

### Motivation

Today, after every OSMO deployment, an administrator must manually run `osmo config update` CLI commands to configure the instance. This is error-prone, not version-controlled, and doesn't fit a GitOps deployment model.

### Problem

- Config changes are imperative (CLI commands) rather than declarative (checked into Git)
- No way to reproduce a config state from source control
- Config drift between environments is invisible until something breaks
- New deployments require manual post-deploy setup steps

## Architecture

### Two Global Modes

A single toggle `configs.enabled` controls the entire system:

| | **ConfigMap Mode** (`enabled: true`) | **DB Mode** (`enabled: false` / absent) |
|---|---|---|
| Source of truth | ConfigMap (Helm values / GitOps) | Database (CLI/API) |
| Config writes | ALL write endpoints return 409 | Normal CLI/API behavior |
| Config reads | In-memory dict (parsed from file) | Database |
| How configs change | Edit Helm values, deploy via ArgoCD/Flux, kubelet updates mount, watchdog detects, reload | `osmo config update` / API calls |
| File watcher | Active (watchdog/inotify) | Not running |
| DB role | Runtime state only (agent heartbeats, k8s_uid) | Persistent store for everything |

There are no per-config management modes. Either all configs come from ConfigMap or all configs come from the database. This simplifies the system and eliminates drift reconciliation (since CLI writes are fully blocked in ConfigMap mode, drift is impossible).

### Config vs Runtime Data Separation

Not everything in the system is configuration. Some data is generated at runtime by services or agents:

| Data | Source | ConfigMap Mode | DB Mode |
|---|---|---|---|
| Singleton configs (service, workflow, dataset) | Admin | In-memory dict | DB |
| Backend config (scheduler_settings, node_conditions) | Admin | In-memory dict | DB |
| Backend runtime (k8s_uid, last_heartbeat, version) | Agent | DB (backends table) | DB |
| Pools, templates, validations, backend_tests | Admin | In-memory dict | DB |
| Roles + external role mappings | Admin | In-memory dict (both Python + Go) | DB |
| service_auth (RSA keys, login_info) | Service startup | DB (auto-generated) | DB |

### Data Flow

```
ConfigMap Mode:

  Helm Values --> K8s ConfigMap --> Mounted File
                                   (/etc/osmo/configs/config.yaml)
                                        |
                     +------------------+------------------+
                     |                                     |
                     v                                     v
          Python ConfigMapWatcher                 Go authz_sidecar
          (watchdog/inotify)                      (file poll 30s)
                     |                                     |
                     v                                     v
          _parsed_configs dict                   FileRoleStore
          (module-level, in-memory)              (roles + external mappings
                     |                            + pool names in-memory)
                     |                                     |
      +--------------+--------------+                      |
      |              |              |                      v
 get_configs()  Backend.fetch()  PodTemplate.fetch()  resolveRoles()
 (singleton)   (config + DB     (pure in-memory)     (IDP group -> OSMO
                runtime merge)                        role, in-memory)

  CLI / API --> config_service --> 409 Guard --> X  (all writes blocked)

  K8s Secret --> Mounted File --> Resolved on parse --> Stored in dict
  (credentials)  (/etc/osmo/secrets/)
```

### Key Components

| Component | File | Purpose |
|---|---|---|
| `configmap_state` | `src/utils/configmap_state.py` | Dependency-free module holding mode boolean + parsed config snapshot. Importable from both utils and service layers without circular deps. |
| `configmap_guard` | `src/service/core/config/configmap_guard.py` | 409 write protection. Single `reject_if_configmap_mode(username)` function. |
| `configmap_loader` | `src/service/core/config/configmap_loader.py` | ConfigMapWatcher class, watchdog event handler, validation, secret resolution. |
| Postgres model methods | `src/utils/connectors/postgres.py` | 13 interception points that check `configmap_state.get_snapshot()` and serve from memory. |
| `FileRoleStore` | `src/utils/roles/file_loader.go` | Go in-memory store for roles, external role mappings, and pool names. Loaded from ConfigMap file, polled for changes. |
| `authz_server` | `src/service/authz_sidecar/server/authz_server.go` | Dual-mode: file-backed (no DB) or DB-backed. Uses `FileRoleStore` for role resolution when `--roles-file` is set. |

### How File Changes Are Detected

**Python service**: Using the `watchdog` library (v6.0.0, already a project dependency for rsync) with inotify backend on Linux. Watches the parent directory to detect K8s ConfigMap atomic symlink swaps. 2-second debounce for rapid events.

**Go authz_sidecar**: Polls file modification time every 30 seconds via `os.Stat()`. Reloads roles, external mappings, and pool names on change.

### Validation

All-or-nothing validation before applying — same pattern as `nginx -t`:

1. Parse ConfigMap YAML
2. Resolve all secret file references
3. Validate each section by constructing Pydantic models (ServiceConfig, WorkflowConfig, etc.)
4. If ANY section fails validation: log error, keep previous config, service continues
5. If ALL pass: atomic swap of module-level dict reference

On first deployment with bad config: service starts with DB defaults (from `configure_app()`), ConfigMap mode is NOT activated, ERROR log shows what's wrong.

### 409 Write Protection

In ConfigMap mode, ALL config write endpoints return HTTP 409 Conflict:

```
Configs are managed by ConfigMap and cannot be modified via CLI/API.
Update the Helm values and redeploy instead.
```

29 guard call sites across `config_service.py` (27) and `helpers.py` (2).

### Secret Handling

Credentials are **never stored in ConfigMap or Helm values**. Instead:

1. K8s Secret created out-of-band (Vault, ExternalSecrets, or `kubectl create secret`)
2. Secret mounted into pod via Helm-generated volume/volumeMount
3. ConfigMap references the secret via `secretName` or `credentialSecretName`
4. Helm template transforms `secretName` to `secret_file` path
5. Loader reads the file during parse and injects resolved credentials into the in-memory dict

Supports three secret formats:
- Simple string: `{value: "token-value"}` (e.g., Slack tokens)
- Docker registry: `.dockerconfigjson` format (auto-detected)
- YAML dict: arbitrary key-value pairs (e.g., storage credentials)

### Backend Config + Runtime Merge

Backend reads merge config from the in-memory dict with runtime data from DB:

| ConfigMap | Agent Connected | Behavior |
|---|---|---|
| Declared | Yes | Config fields from dict, runtime (heartbeat, k8s_uid) from DB |
| Declared | No | Config fields from dict, runtime defaults to empty (offline) |
| Not declared | Yes | Excluded from config list (agent row exists but not managed) |

Agent code (`service/agent/helpers.py`) is unchanged — it continues writing heartbeats and k8s_uid to the `backends` table.

### Authz Sidecar — File-Backed Roles

The Go authz_sidecar reads roles directly from the ConfigMap file via `FileRoleStore`, eliminating the PostgreSQL dependency in ConfigMap mode.

**How it works:**
1. `--roles-file` flag set in Helm template when `configs.enabled=true`
2. `FileRoleStore` loads roles + `external_roles` mappings from YAML on startup
3. Builds reverse map: `externalRole -> []osmoRoleName` for fast IDP resolution
4. On each auth check, `ResolveExternalRoles()` maps JWT claims to OSMO roles in-memory
5. No `user_roles` DB table, no `SyncUserRoles` SQL — IDP groups are the source of truth
6. Pool names for RBAC evaluation also come from the file

**User role management:**
- Users are assigned roles via IDP group membership (e.g., Azure AD groups)
- Adding a user to a role = adding them to the IDP group (done in Azure AD, not OSMO)
- The `external_roles` field in each role definition maps IDP groups to OSMO roles
- No per-user role assignments in OSMO — all role assignments are declarative via IDP

**Helm template behavior:**
- `configs.enabled=true`: authz_sidecar gets `--roles-file`, no postgres args, ConfigMap volume mounted
- `configs.enabled=false`: authz_sidecar gets postgres args (legacy DB mode)

### Runtime Field Injection

`service_auth` (RSA keys) and `service_base_url` are auto-generated by `configure_app()` on startup — they are NOT in the ConfigMap. The loader injects them:

- First load: reads from DB (configure_app has already written them)
- Subsequent reloads: carries forward from previous snapshot

`service_base_url` is also auto-derived from `services.service.hostname` in the Helm template if not explicitly set.

## Chart Defaults vs Per-Deployment Values

The chart `values.yaml` ships with product defaults. Per-deployment values only need site-specific overrides.

### Chart Defaults (values.yaml)

| Config | Default |
|---|---|
| Workflow limits | `max_num_tasks: 100`, `max_exec_timeout: 30d`, `default_exec_timeout: 7d` |
| Pod templates | `default_ctrl` (1 CPU, 1Gi), `default_user` (templated placeholders) |
| Resource validations | `default_cpu` (LE node_cpu, GT 0), `default_memory` (LE node_memory, GT 0) |
| Roles | `osmo-admin` (wildcard), `osmo-user` (workflow/data ops), `osmo-default` (login/profile), `osmo-ctrl` (internal), `osmo-backend` (internal) |
| Backend | `default` (kai scheduler, 30s timeout) |
| Pool | `default` (references default backend, default platform) |
| `service_base_url` | Auto-derived from `services.service.hostname` |

### Per-Deployment Overrides (site values)

| Config | Why site-specific |
|---|---|
| `configs.enabled` | Toggle ConfigMap mode |
| Workflow limit overrides | Different limits per environment |
| `backend_images.credential` | Registry secret name varies |
| `cli_config` versions | Tied to deployed version |
| Dataset buckets + credentials | Storage paths and secrets vary |
| Additional backends | Site-specific clusters |
| `external_roles` on roles | IDP group names are org-specific |

### Example Per-Deployment Values

```yaml
services:
  configs:
    enabled: true

    workflow:
      config:
        max_num_tasks: 200
        max_exec_timeout: "60d"
        backend_images:
          credential:
            secretName: imagepullsecret
            secretKey: .dockerconfigjson

    service:
      config:
        cli_config:
          min_supported_version: "6.0.0"
          latest_version: "6.2.12"

    dataset:
      config:
        default_bucket: sandbox
        buckets:
          sandbox:
            dataset_path: "s3://my-bucket"
            region: "us-west-2"
            mode: "read-write"
            default_credential:
              credentialSecretName: my-bucket-cred
```

## Testing

### Unit Tests (23 tests)
- ConfigMap guard: 409 when active, allow when inactive, bypass for configmap-sync
- Config state: snapshot set/get, atomic swap preserves old references
- Secret resolution: success, missing file, simple string, Docker registry, secretName conversion
- Validation: valid sections, invalid items type, unknown keys, empty configs
- ConfigMapWatcher: file not found, no managed_configs, populates snapshot, injects runtime fields, validation failure preserves previous config
- Event handler: ignores unrelated events, reacts to config file events, reacts to ..data symlink events

### Integration Tests (testcontainers PostgreSQL)
- Singleton configs served from snapshot
- Named configs (PodTemplate, ResourceValidation) served from snapshot
- 409 rejection on patch/put endpoints
- 409 bypass for configmap-sync username
- ConfigMapWatcher loads configs into snapshot

### Go Tests
- Existing `roles_test` and `server_test` pass (DB-backed path unchanged)
- `server_integration_test` passes (testcontainers PostgreSQL)

### E2E Tests (validated on live dev instance)

| Test | Result |
|---|---|
| Service startup: ConfigMap loaded, mode activated, watcher started | PASS |
| Authz sidecar: 5 roles loaded from file, ConfigMap mode, migration skipped | PASS |
| No errors in either container | PASS |
| GET workflow (max_num_tasks, registry credential) | PASS |
| GET service (service_base_url auto-derived, service_auth injected) | PASS |
| GET dataset (bucket credentials resolved from K8s Secret) | PASS |
| GET pod templates (from chart defaults) | PASS |
| GET backends (default, config from memory + runtime from DB) | PASS |
| GET pools (default, status computed from DB heartbeat) | PASS |
| GET resource validations (ResourceAssertion format, HTTP 200) | PASS |
| GET roles (5 roles from chart defaults) | PASS |
| 409: PATCH workflow, PUT pod template, DELETE backend | PASS |
| 409: DELETE pool, DELETE dataset bucket, rollback | PASS |

## Backwards Compatibility

- Fully backwards compatible: `configs.enabled: false` (default) preserves current behavior
- No DB schema changes required
- Agent code unchanged
- CLI works normally in DB mode
- Authz sidecar falls back to DB mode when `--roles-file` is not set

## Open Questions

- [x] Per-config or global mode? -> Global mode (team feedback)
- [x] Polling or event watching? -> Watchdog/inotify events with 2s debounce (team feedback)
- [x] Write to DB or serve from memory? -> In-memory, standard K8s pattern (team feedback)
- [x] How to handle runtime data (heartbeats)? -> Separate: config from memory, runtime from DB
- [x] How to handle roles (authz_sidecar)? -> File-backed FileRoleStore, no DB needed
- [x] What about service_auth? -> Inject from DB on first load, carry forward on reloads
- [x] What about user role assignments? -> IDP groups are source of truth, no per-user DB state
- [x] What should be chart defaults vs per-deployment? -> Product roles/templates/validations/defaults in chart, site-specific overrides per deployment
- [ ] Should the CLI display warnings when in ConfigMap mode?
- [ ] Health check endpoint for ConfigMap mode status?
